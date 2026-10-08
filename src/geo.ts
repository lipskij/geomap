// Small geometry helpers for GeoJSON polygons ([lng, lat] coordinates)

export type Rings = number[][][]; // [outer, ...holes]
export type BBox = [number, number, number, number]; // minLng, minLat, maxLng, maxLat

// Finite, on the globe, and not the 0,0 "no fix" placeholder
export const validPos = (lat?: number, lng?: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat!) <= 90 &&
  Math.abs(lng!) <= 180 &&
  !(lat === 0 && lng === 0);

export const fmtPos = (lat: number, lng: number) =>
  `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

export function bboxOf(rings: Rings): BBox {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of rings[0]) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
}

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  // Hot loop (zones have thousands of vertices): index access, no destructuring
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function inPolygon(
  lng: number,
  lat: number,
  rings: Rings,
  bbox: BBox,
): boolean {
  const [a, b, c, d] = bbox;
  if (lng < a || lng > c || lat < b || lat > d) return false;
  if (!inRing(lng, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}

const R = 6_371_000; // earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;

// Great-circle distance (haversine)
export function distanceM(
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
