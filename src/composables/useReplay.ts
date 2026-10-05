import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import type { Detections, PathPoint } from "../types";
import {
  parseTrackFile,
  type ReplayPoint,
  type ReplayTrack,
} from "../replay/parse";
import { checkPosition, isZoneActive, type Zone } from "../zones";
import { MAX_ALT_M } from "../config";
import { validPos } from "../geo";

const TICK_MS = 250;
export const REPLAY_PREFIX = "R-"; // replayed IDs are prefixed so they never collide with live ones

const R = 6_371_000; // earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;

function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Last point index with t <= time
function indexAt(pts: ReplayPoint[], time: number): number {
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// "mm:ss", or "h:mm:ss" from one hour
export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type Tuple = [number, number]; // lat, lng

export interface TrackStats {
  id: string;
  maxSpeed: number; // m/s
  maxAlt: number; // m
  aboveMaxMs: number; // time above MAX_ALT_M
  zoneEntries: number | null; // entries into active prohibited zones; null without zone data
  zones: { name: string; ms: number }[]; // prohibited zones entered, time inside each
  distance: number; // m flown
  maxPilotDist: number; // m, from the pilot, or from takeoff when the file has no pilot data
  fromTakeoff: boolean;
  maxGap: number; // ms, longest time between two recorded points
  startTime: number; // ms since epoch
  endTime: number;
  start: Tuple;
  end: Tuple;
  pilot: Tuple | null; // first known pilot position
  altProfile: Tuple[]; // [ms, m], at most PROFILE_POINTS, keeps each bucket's peak
}

const PROFILE_POINTS = 120;

function altProfile(pts: ReplayPoint[]): Tuple[] {
  const size = Math.ceil(pts.length / PROFILE_POINTS);
  const out: Tuple[] = [];
  for (let i = 0; i < pts.length; i += size) {
    let peak = pts[i];
    for (const p of pts.slice(i, i + size)) if (p.alt > peak.alt) peak = p;
    out.push([peak.t, peak.alt]);
  }
  return out;
}

// Whole-track summary (replayed or live drone; pts must not be empty). Time between
// two points is attributed to the state at the earlier one (zones inside, above the limit).
export function trackStats(
  id: string,
  pts: ReplayPoint[],
  zones: Zone[],
): TrackStats {
  const first = pts[0];
  const last = pts[pts.length - 1];
  const pilotPt = pts.find((p) => validPos(p.pilotLat, p.pilotLng));
  let maxSpeed = 0;
  let maxAlt = -Infinity;
  let aboveMaxMs = 0;
  let zoneEntries = 0;
  let distance = 0;
  let maxPilotDist = 0;
  let maxGap = 0;
  const zoneTime = new Map<string, { name: string; ms: number }>();
  let inside: Zone[] = [];
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    if (prev) {
      const dt = p.t - prev.t;
      const d = distanceM(prev, p);
      distance += d;
      maxGap = Math.max(maxGap, dt);
      if (prev.alt > MAX_ALT_M) aboveMaxMs += dt;
      for (const z of inside) zoneTime.get(z.id)!.ms += dt;
      maxSpeed = Math.max(maxSpeed, p.speed ?? d / (dt / 1000));
    } else if (p.speed !== undefined) maxSpeed = p.speed;
    maxAlt = Math.max(maxAlt, p.alt);

    const origin = pilotPt
      ? validPos(p.pilotLat, p.pilotLng)
        ? { lat: p.pilotLat!, lng: p.pilotLng! }
        : undefined
      : first;
    if (origin) maxPilotDist = Math.max(maxPilotDist, distanceM(origin, p));

    const now = checkPosition(p.lat, p.lng, p.alt, zones, MAX_ALT_M).zones.filter(
      (z) => z.restriction === "PROHIBITED" && isZoneActive(z, new Date(p.t)),
    );
    for (const z of now) {
      if (inside.some((o) => o.id === z.id)) continue;
      zoneEntries++;
      if (!zoneTime.has(z.id)) zoneTime.set(z.id, { name: z.name, ms: 0 });
    }
    inside = now;
  });
  return {
    id,
    maxSpeed,
    maxAlt,
    aboveMaxMs,
    zoneEntries: zones.length ? zoneEntries : null,
    zones: [...zoneTime.values()],
    distance,
    maxPilotDist,
    fromTakeoff: !pilotPt,
    maxGap,
    startTime: first.t,
    endTime: last.t,
    start: [first.lat, first.lng],
    end: [last.lat, last.lng],
    pilot: pilotPt ? [pilotPt.pilotLat!, pilotPt.pilotLng!] : null,
    altProfile: altProfile(pts),
  };
}

export function useReplay() {
  const tracks = shallowRef<ReplayTrack[]>([]);
  const fileName = ref("");
  const error = ref<string | null>(null);
  const playing = ref(false);
  const speed = ref(1);
  const position = ref(0); // ms since start of recording
  const detections = shallowRef<Detections>({});

  const start = computed(() =>
    Math.min(...tracks.value.map((t) => t.points[0].t)),
  );
  const end = computed(() =>
    Math.max(...tracks.value.map((t) => t.points[t.points.length - 1].t)),
  );
  const duration = computed(() =>
    tracks.value.length ? end.value - start.value : 0,
  );

  function render() {
    const abs = start.value + position.value;
    const nowSec = Date.now() / 1000;
    const out: Detections = {};
    for (const track of tracks.value) {
      const pts = track.points;
      if (abs < pts[0].t) continue; // not started yet
      const i = indexAt(pts, abs);
      const a = pts[i];
      const b = pts[Math.min(i + 1, pts.length - 1)];
      const ended = i === pts.length - 1;
      const f = ended ? 0 : (abs - a.t) / (b.t - a.t);
      const seg = ended ? pts[i - 1] : a; // segment used for speed
      const segEnd = ended ? a : b;
      const id = REPLAY_PREFIX + track.id;
      out[id] = {
        basic_id: id,
        rssi: a.rssi ?? -60,
        drone_lat: a.lat + (b.lat - a.lat) * f,
        drone_long: a.lng + (b.lng - a.lng) * f,
        drone_altitude: Math.round(a.alt + (b.alt - a.alt) * f),
        drone_speed: ended
          ? 0
          : (a.speed ?? distanceM(seg, segEnd) / ((segEnd.t - seg.t) / 1000)),
        pilot_lat: a.pilotLat ?? 0,
        pilot_long: a.pilotLng ?? 0,
        // After its last point a drone ages like a silent one (fades, then disappears)
        last_update: ended ? nowSec - (abs - a.t) / 1000 : nowSec,
      };
    }
    detections.value = out;
  }

  const timer = setInterval(() => {
    if (!tracks.value.length) return;
    if (playing.value) {
      position.value = Math.min(
        position.value + TICK_MS * speed.value,
        duration.value,
      );
      if (position.value >= duration.value) playing.value = false;
    }
    render();
  }, TICK_MS);
  onBeforeUnmount(() => clearInterval(timer));

  async function load(file: File) {
    error.value = null;
    try {
      const parsed = await parseTrackFile(file);
      close();
      tracks.value = parsed;
      fileName.value = file.name;
      position.value = 0;
      speed.value = 1;
      playing.value = true;
      render();
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  // Each replayed drone's path from the start of its track up to the current position
  function pathsAtPosition(): Record<string, PathPoint[]> {
    const abs = start.value + position.value;
    const out: Record<string, PathPoint[]> = {};
    for (const track of tracks.value) {
      const id = REPLAY_PREFIX + track.id;
      const pts: PathPoint[] = track.points
        .filter((p) => p.t <= abs)
        .map((p) => [p.lat, p.lng, p.t]);
      const d = detections.value[id];
      if (d) pts.push([d.drone_lat, d.drone_long, abs]); // current (interpolated) position
      out[id] = pts;
    }
    return out;
  }

  function seek(ms: number) {
    position.value = Math.max(0, Math.min(ms, duration.value));
    render();
  }

  function toggle() {
    if (!playing.value && position.value >= duration.value) seek(0); // replay from start
    playing.value = !playing.value;
  }

  function close() {
    error.value = null;
    tracks.value = [];
    fileName.value = "";
    playing.value = false;
    position.value = 0;
    detections.value = {};
  }

  return {
    tracks,
    fileName,
    error,
    playing,
    speed,
    position,
    duration,
    detections,
    load,
    seek,
    toggle,
    close,
    pathsAtPosition,
  };
}
