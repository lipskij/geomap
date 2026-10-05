// Small geometry helpers for GeoJSON polygons ([lng, lat] coordinates)

export type Rings = number[][][]; // [outer, ...holes]
export type BBox = [number, number, number, number]; // minLng, minLat, maxLng, maxLat

// Finite and not the 0,0 "no fix" placeholder
export const validPos = (lat?: number, lng?: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

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
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
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
