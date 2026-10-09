import type { Bearing } from "../acoustic";
import { offset } from "../acoustic";
import { rangeOf, type Sensor } from "../composables/useSensors";
import { distanceM } from "../geo";

// Acoustic mesh out in farmland (rural Kėdainiai district): 3 × 3 audio sensors, 250 m apart
const ORIGIN = { lat: 55.43, lng: 24.02 }; // south-west corner
const SPACING_M = 250;
const at = (northM: number, eastM: number) => {
  const [lat] = offset(ORIGIN, northM, 0);
  const [, lng] = offset(ORIGIN, eastM, 90);
  return { lat, lng };
};
export const MOCK_ACOUSTIC_SENSORS: Sensor[] = [0, 1, 2].flatMap((row) =>
  [0, 1, 2].map((col) => ({
    id: 901 + row * 3 + col,
    type: "audio" as const,
    noise: "rural" as const,
    ...at(row * SPACING_M, col * SPACING_M),
  })),
);

// One drone flying straight across the mesh, south-west to north-east, then quiet long
// enough for its track to clear, then the same pass again
const CENTER = at(SPACING_M, SPACING_M);
const COURSE = 50; // deg
const SPEED = 15; // m/s
const PASS_M = 1400; // from well outside the mesh to well outside the other side
const QUIET_S = 15; // longer than FADE_SECONDS
const SIGMA = 3; // ± deg bearing error

const start = Date.now();

export function getMockBearings(): Bearing[] {
  const t = Date.now();
  const cycle = PASS_M / SPEED + QUIET_S;
  const s = (((t - start) / 1000) % cycle) * SPEED;
  if (s > PASS_M) return [];
  const [lat, lng] = offset(CENTER, s - PASS_M / 2, COURSE);
  const drone = { lat, lng };
  return MOCK_ACOUSTIC_SENSORS.filter((a) => distanceM(a, drone) <= rangeOf(a)).map((a) => {
    const north = (lat - a.lat) * 111_320;
    const east = (lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const deg = (Math.atan2(east, north) * 180) / Math.PI;
    return {
      sensorId: a.id,
      deg: (deg + (Math.random() * 2 - 1) * SIGMA + 360) % 360,
      sigmaDeg: SIGMA,
      t,
    };
  });
}
