// How built-up the ground around a point is, read from OpenStreetMap tiles (standard
// style colours), to guess the background noise an acoustic sensor hears there.
// Measured on z15 tiles (2026-10): fields and forest 0.05–0.09; town centres, suburbs
// and villages 0.43–0.55. Houses and city blocks share one grey, so suburbs can't be told
// from centres: built-up reads as urban, the short range, which never overstates coverage.
// ponytail: depends on the map style's colours; move to OSM landuse/road data on the
// backend if the style changes or suburbs need their own range
import type { Noise } from "./composables/useSensors";
import { pixel } from "./terrain";

const TILE_URL = "https://tile.openstreetmap.org/15/{x}/{y}.png";
const Z = 15;
const SIZE = 256;
const RADIUS_M = 300; // area around the sensor that sets its noise
// OSM Carto: residential, building, commercial, retail, industrial, parking, and the
// motorway / trunk / primary / secondary roads that carry traffic
const BUILT: [number, number, number][] = [
  [224, 223, 223], [217, 208, 201], [242, 218, 217], [255, 214, 209], [235, 219, 232],
  [238, 238, 238], [232, 146, 162], [249, 178, 156], [252, 214, 164], [247, 250, 191],
];
const TOLERANCE = 12; // summed RGB difference: anti-aliased edges still match

const tiles = new Map<string, Promise<Uint8ClampedArray | null>>();

function fetchTile(x: number, y: number): Promise<Uint8ClampedArray | null> {
  const key = `${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = fetch(TILE_URL.replace("{x}", String(x)).replace("{y}", String(y)))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, SIZE, SIZE).data;
      })
      .catch(() => {
        tiles.delete(key); // retry next time
        return null;
      });
    tiles.set(key, p);
  }
  return p;
}

const isBuilt = (d: Uint8ClampedArray, i: number) =>
  BUILT.some(([r, g, b]) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) <= TOLERANCE);

export const noiseFromBuiltShare = (builtShare: number): Noise =>
  builtShare < 0.15 ? "rural" : builtShare < 0.3 ? "suburban" : "urban";

// null when the map tiles can't be loaded
export async function noiseAt(lat: number, lng: number): Promise<Noise | null> {
  const [cx, cy] = pixel(lat, lng, Z);
  const r = RADIUS_M / ((156_543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** Z); // px
  let built = 0, all = 0;
  for (let tx = Math.floor((cx - r) / SIZE); tx <= Math.floor((cx + r) / SIZE); tx++)
    for (let ty = Math.floor((cy - r) / SIZE); ty <= Math.floor((cy + r) / SIZE); ty++) {
      const d = await fetchTile(tx, ty);
      if (!d) return null;
      for (let y = 0; y < SIZE; y += 2)
        for (let x = 0; x < SIZE; x += 2) {
          if (Math.hypot(tx * SIZE + x - cx, ty * SIZE + y - cy) > r) continue;
          all++;
          if (isBuilt(d, (y * SIZE + x) * 4)) built++;
        }
    }
  return all ? noiseFromBuiltShare(built / all) : null;
}
