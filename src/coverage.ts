import type { LatLngBoundsLiteral } from "leaflet";

export interface Circle {
  lat: number;
  lng: number;
  range: number; // m
}

const M_PER_DEG = 111_320;
const MAX_CELLS = 300; // per side; keeps a redraw well under a frame for dozens of sensors

// RGBA per number of sensors covering a cell: 2 = cross-bearing, 3+ = triangulation
const SHADE: Record<2 | 3, [number, number, number, number]> = {
  2: [245, 166, 35, 90],
  3: [24, 160, 80, 110],
};

// Image of where 2+ coverage circles overlap, for an L.imageOverlay over `bounds`.
// ponytail: flat-earth grid stretched over the bounds; fine for plans a few km
// across, use a projected grid if plans grow to country size
export function overlapImage(
  circles: Circle[],
): { url: string; bounds: LatLngBoundsLiteral } | null {
  if (circles.length < 2) return null;
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
      let count = 0;
      for (const c of circles) {
        const dy = (lat - c.lat) * M_PER_DEG;
        const dx = (lng - c.lng) * mLng;
        if (dx * dx + dy * dy <= c.range * c.range) count++;
      }
      if (count < 2) continue;
      any = true;
      img.data.set(SHADE[count >= 3 ? 3 : 2], (y * cols + x) * 4);
    }
  }
  if (!any) return null;
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), bounds: [[s, w], [n, e]] };
}
