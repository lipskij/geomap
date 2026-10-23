// Ground elevation for line-of-sight checks (not drawn on the map).
// Terrarium tiles on AWS Open Data: for Lithuania the source is EU-DEM (25 m), z12 ≈ 22 m/px.
// ponytail: tiles fetched from the browser; move to a backend DEM (e.g. the national
// LiDAR model) if forests/buildings need to count, EU-DEM is mostly bare ground
const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/{x}/{y}.png";
const Z = 12;
const SIZE = 256;

const ready = new Map<string, Float32Array>(); // decoded tiles
const pixels = new Map<string, Promise<Uint8ClampedArray | null>>();

// Global pixel position at zoom z (Web Mercator, 256 px tiles)
export function pixel(lat: number, lng: number, z = Z): [number, number] {
  const n = SIZE * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

// RGBA of a 256 px tile, file colours as is (no colour management). Cached; a failed
// fetch resolves null and is tried again on the next call. Also used by landuse.ts
export function tilePixels(url: string): Promise<Uint8ClampedArray | null> {
  let p = pixels.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
      .then((bmp) => {
        const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, SIZE, SIZE).data;
      })
      .catch(() => {
        pixels.delete(url);
        return null;
      });
    pixels.set(url, p);
  }
  return p;
}

async function fetchTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (ready.has(key)) return;
  const px = await tilePixels(TILE_URL.replace("{x}", String(x)).replace("{y}", String(y)));
  if (!px || ready.has(key)) return;
  const elev = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < elev.length; i++)
    elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  ready.set(key, elev);
}

// Fetch the tiles covering these lat/lng boxes ([south, west, north, east])
export async function loadTerrain(boxes: [number, number, number, number][]): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [s, w, n, e] of boxes) {
    const [x0, y0] = pixel(n, w).map((v) => Math.floor(v / SIZE));
    const [x1, y1] = pixel(s, e).map((v) => Math.floor(v / SIZE));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(fetchTile(x, y));
  }
  await Promise.all(jobs);
}

// Elevation in metres from loaded tiles (nearest pixel); NaN where no tile is loaded
// (line of sight then treats the spot as visible)
export function elevation(lat: number, lng: number): number {
  const [px, py] = pixel(lat, lng);
  const tx = Math.floor(px / SIZE), ty = Math.floor(py / SIZE);
  const t = ready.get(`${tx}/${ty}`);
  if (!t) return NaN;
  return t[Math.floor(py - ty * SIZE) * SIZE + Math.floor(px - tx * SIZE)];
}
