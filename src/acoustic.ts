// Acoustic arrays: each reports a bearing, the compass direction from the sensor to the
// sound. Bearings from 2+ sensors at about the same time cross where the drone is;
// successive crossings (fixes) give the direction it's flying (heading) and its speed

export interface Bearing {
  sensorId: number;
  trackId?: string; // live feed: the contact track it came from (camera images)
  deg: number; // 0 = north, clockwise
  sigmaDeg: number; // ± measurement error
  t: number; // ms
}

export interface Fix {
  lat: number;
  lng: number;
  errM: number; // rough position error radius
  t: number; // ms
  sensors: number; // how many sensors crossed
}

export interface Heading {
  deg: number;
  sigmaDeg: number;
  speed: number; // m/s
}

export interface AcousticTrack {
  bearings: Bearing[]; // the ones behind the newest fix; empty while the track fades
  fixes: Fix[]; // oldest first
  heading?: Heading;
}

type Pos = { lat: number; lng: number };

const M_PER_DEG = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mPerDegLng = (lat: number) => M_PER_DEG * Math.cos(rad(lat));

// Point `m` metres from `p` along compass bearing `d` (flat earth: fine at sensor ranges)
export function offset(p: Pos, m: number, d: number): [number, number] {
  return [
    p.lat + (m * Math.cos(rad(d))) / M_PER_DEG,
    p.lng + (m * Math.sin(rad(d))) / mPerDegLng(p.lat),
  ];
}

// Least-squares crossing point of the bearing lines; null when fewer than 2 sensors,
// when the lines are near parallel, or when the point lies behind a sensor
export function crossBearings(bs: Bearing[], sensors: Map<number, Pos>): Fix | null {
  // ±90° or wider: heard, but the direction is unknown, so it can't cross anything
  const used = bs.filter((b) => sensors.has(b.sensorId) && b.sigmaDeg < 90);
  if (new Set(used.map((b) => b.sensorId)).size < 2) return null;
  const o = sensors.get(used[0].sensorId)!;
  const mLng = mPerDegLng(o.lat);
  const lines = used.map((b) => {
    const s = sensors.get(b.sensorId)!;
    return {
      x: (s.lng - o.lng) * mLng,
      y: (s.lat - o.lat) * M_PER_DEG,
      dx: Math.sin(rad(b.deg)),
      dy: Math.cos(rad(b.deg)),
      sigma: b.sigmaDeg,
    };
  });
  // Minimise the sum of squared distances to each line: normal equations, 2x2
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (const l of lines) {
    const nx = -l.dy, ny = l.dx;
    const c = nx * l.x + ny * l.y;
    a11 += nx * nx;
    a12 += nx * ny;
    a22 += ny * ny;
    b1 += nx * c;
    b2 += ny * c;
  }
  const det = a11 * a22 - a12 * a12; // for 2 lines: sin² of the angle between them
  if (det < 0.05) return null; // under ~13° apart: the crossing slides along the lines
  const x = (a22 * b1 - a12 * b2) / det;
  const y = (a11 * b2 - a12 * b1) / det;
  if (lines.some((l) => (x - l.x) * l.dx + (y - l.y) * l.dy <= 0)) return null;
  // ponytail: error = mean sideways spread of the wedges at the fix, widened when they
  // cross at a shallow angle; a proper covariance ellipse if precision matters
  const spread =
    lines.reduce((s, l) => s + Math.hypot(x - l.x, y - l.y) * Math.tan(rad(l.sigma)), 0) /
    lines.length;
  return {
    lat: o.lat + y / M_PER_DEG,
    lng: o.lng + x / mLng,
    errM: spread / Math.sqrt(det),
    t: Math.max(...used.map((b) => b.t)),
    sensors: lines.length,
  };
}

// Heading from the move between the averaged older and newer half of the fixes;
// undefined while it hasn't moved more than its position error (hovering, or too few fixes)
export function headingOf(fixes: Fix[]): Heading | undefined {
  if (fixes.length < 3) return;
  const half = Math.floor(fixes.length / 2);
  const mean = (fs: Fix[], k: "lat" | "lng" | "t" | "errM") =>
    fs.reduce((s, f) => s + f[k], 0) / fs.length;
  const a = fixes.slice(0, half), b = fixes.slice(-half);
  const x = (mean(b, "lng") - mean(a, "lng")) * mPerDegLng(mean(a, "lat"));
  const y = (mean(b, "lat") - mean(a, "lat")) * M_PER_DEG;
  const d = Math.hypot(x, y);
  const err = (mean(a, "errM") + mean(b, "errM")) / Math.sqrt(half);
  if (d <= err) return;
  return {
    deg: (deg(Math.atan2(x, y)) + 360) % 360,
    sigmaDeg: deg(Math.atan(err / d)),
    speed: d / ((mean(b, "t") - mean(a, "t")) / 1000),
  };
}

// Go / no-go for sending interceptors: every check must pass.
// ponytail: fixed thresholds, a first guess; tune with the operators on real data
export const READY = {
  minSensors: 3, // 2 bearings always cross somewhere; a 3rd confirms the point
  maxErrM: 50,
  maxHeadingSigmaDeg: 30,
  maxAgeS: 3,
};

export interface Readiness {
  sensors: boolean;
  position: boolean;
  heading: boolean;
  fresh: boolean;
  ok: boolean;
}

export function assess(track: AcousticTrack, now: number): Readiness {
  const last = track.fixes[track.fixes.length - 1];
  const r = {
    sensors: last.sensors >= READY.minSensors,
    position: last.errM <= READY.maxErrM,
    heading: !!track.heading && track.heading.sigmaDeg <= READY.maxHeadingSigmaDeg,
    fresh: now - last.t <= READY.maxAgeS * 1000,
  };
  return { ...r, ok: r.sensors && r.position && r.heading && r.fresh };
}
