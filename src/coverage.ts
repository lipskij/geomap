import type { LatLngBoundsLiteral } from "leaflet";

export interface Circle {
  lat: number;
  lng: number;
  range: number; // m
}

const M_PER_DEG = 111_320;
const MAX_CELLS = 300; // per side; keeps a redraw well under a frame for dozens of sensors

// RGBA per number of sensors covering a cell: 2 = cross-bearing, 3+ = triangulation
// 0 = in range of a sensor but hidden from all of them by terrain
const SHADE: Record<0 | 2 | 3, [number, number, number, number]> = {
  0: [90, 90, 90, 110],
  2: [245, 166, 35, 90],
  3: [24, 160, 80, 110],
};

// Line of sight from a sensor mast to a drone flying TARGET_AGL_M above the ground.
// ponytail: same heights for every type and plan; make them per sensor with the real
// sensor list. Acoustic is treated like the others though sound bends around hills
export const SENSOR_MAST_M = 3;
export const TARGET_AGL_M = 30; // low flyers are the ones terrain hides
const RAYS = 360;
const STEP_M = 20; // ≈ terrain pixel size

export type Elevation = (lat: number, lng: number) => number; // m, NaN = unknown

// Visibility test for points around one sensor: rays out from the sensor, a point is seen
// when the drone above it rises over every terrain point between it and the sensor.
// Earth curvature ignored (8 cm at 1 km)
export function lineOfSight(c: Circle, elev: Elevation, mLng: number) {
  const h0 = elev(c.lat, c.lng) + SENSOR_MAST_M;
  if (Number.isNaN(h0)) return () => true;
  const steps = Math.ceil(c.range / STEP_M) + 1;
  const seen = new Uint8Array(RAYS * steps);
  for (let r = 0; r < RAYS; r++) {
    const a = (2 * Math.PI * r) / RAYS;
    const north = Math.cos(a) / M_PER_DEG, east = Math.sin(a) / mLng;
    let horizon = -Infinity; // steepest terrain slope seen so far on this ray
    seen[r * steps] = 1;
    for (let i = 1; i < steps; i++) {
      const d = i * STEP_M;
      const g = elev(c.lat + d * north, c.lng + d * east);
      // NaN ground: unknown, counts as seen and doesn't raise the horizon
      if (!((g + TARGET_AGL_M - h0) / d < horizon)) seen[r * steps + i] = 1;
      const slope = (g - h0) / d;
      if (slope > horizon) horizon = slope;
    }
  }
  return (dx: number, dy: number) => {
    const r = Math.round((Math.atan2(dx, dy) / (2 * Math.PI)) * RAYS + RAYS) % RAYS;
    const i = Math.min(steps - 1, Math.round(Math.hypot(dx, dy) / STEP_M));
    return seen[r * steps + i] === 1;
  };
}

// Image of where 2+ coverage circles overlap, for an L.imageOverlay over `bounds`.
// ponytail: flat-earth grid stretched over the bounds; fine for plans a few km
// across, use a projected grid if plans grow to country size
// and of spots in range but hidden by terrain (elev omitted = flat ground).
export function overlapImage(
  circles: Circle[],
  elev: Elevation = () => NaN,
): { url: string; bounds: LatLngBoundsLiteral } | null {
  if (!circles.length) return null;
  const lat0 = circles.reduce((a, c) => a + c.lat, 0) / circles.length;
  const mLng = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  // Bounding box of all circles, in degrees
  let s = 90, n = -90, w = 180, e = -180;
  for (const c of circles) {
    s = Math.min(s, c.lat - c.range / M_PER_DEG);
    n = Math.max(n, c.lat + c.range / M_PER_DEG);
    w = Math.min(w, c.lng - c.range / mLng);
    e = Math.max(e, c.lng + c.range / mLng);
  }
  const widthM = (e - w) * mLng;
  const heightM = (n - s) * M_PER_DEG;
  const cell = Math.max(widthM, heightM) / MAX_CELLS;
  const cols = Math.ceil(widthM / cell);
  const rows = Math.ceil(heightM / cell);

  const sees = circles.map((c) => lineOfSight(c, elev, mLng));

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cols, rows);
  let any = false;
  for (let y = 0; y < rows; y++) {
    const lat = n - ((y + 0.5) * cell) / M_PER_DEG;
    for (let x = 0; x < cols; x++) {
      const lng = w + ((x + 0.5) * cell) / mLng;
      let count = 0, inRange = false;
      circles.forEach((c, i) => {
        const dy = (lat - c.lat) * M_PER_DEG;
        const dx = (lng - c.lng) * mLng;
        if (dx * dx + dy * dy > c.range * c.range) return;
        inRange = true;
        if (sees[i](dx, dy)) count++;
      });
      if (count === 1 || !inRange) continue;
      any = true;
      img.data.set(SHADE[count >= 3 ? 3 : (count as 0 | 2)], (y * cols + x) * 4);
    }
  }
  if (!any) return null;
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), bounds: [[s, w], [n, e]] };
}
