import { ref, watch } from "vue";
import type { IconName } from "../icons";
import { loadLocal, loadRemote, savePlan } from "../plans";
import { SENSOR_MAST_M } from "../coverage";
import { noiseAt } from "../landuse";

export type SensorType = "rid" | "audio" | "video";

export interface Sensor {
  id: number;
  type: SensorType;
  lat: number;
  lng: number;
  mastM?: number; // mount height above ground (mast, roof); default SENSOR_MAST_M
  noise?: Noise; // audio only: background noise set by hand; unset = autoNoise
  autoNoise?: Noise; // read from the map around it (landuse.ts); not saved in plan files
}

export interface Plan {
  name: string;
  sensors: Sensor[];
}

// ponytail: rough default detection ranges per type; per-sensor values come later
// with the real sensor list. lineOfSight: hills hide drones from it (sound bends around them)
export const SENSOR_TYPES: Record<
  SensorType,
  { icon: IconName; color: string; range: number; lineOfSight: boolean }
> = {
  rid: { icon: "sensors", color: "#1f7ae0", range: 1000, lineOfSight: true },
  audio: { icon: "mic", color: "#8e44ad", range: 300, lineOfSight: false },
  video: { icon: "videocam", color: "#0f9d8a", range: 800, lineOfSight: true },
};

export type Noise = "rural" | "suburban" | "urban";
// Hearing range of an acoustic sensor by background noise (≈35 / 45 / 60 dB(A)): drone
// sound fades ~6 dB per doubling of distance, so louder surroundings shrink the range.
// AI filtering tells drones from other sounds; it doesn't hear through traffic at the
// same low frequencies. ponytail: first guesses, measure with the real arrays
export const ACOUSTIC_RANGE: Record<Noise, number> = { rural: 500, suburban: 300, urban: 150 };

export const rangeOf = (s: Sensor) =>
  s.type === "audio" ? ACOUSTIC_RANGE[noiseOf(s)] : SENSOR_TYPES[s.type].range;
export const noiseOf = (s: Sensor): Noise => s.noise ?? s.autoNoise ?? "suburban";
export const mastOf = (s: Sensor) => s.mastM ?? SENSOR_MAST_M;

const SAVE_DELAY_MS = 800; // batch quick edits (e.g. several placements) into one save

// The current sensor plan: saved locally on every change, and to the backend when enabled
export function useSensors() {
  const local = loadLocal();
  const name = ref(local?.name ?? "");
  const sensors = ref<Sensor[]>(local?.sensors ?? []);
  const saveError = ref<string | null>(null);
  const nextId = () => Math.max(0, ...sensors.value.map((s) => s.id)) + 1;

  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    [name, sensors],
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        savePlan({ name: name.value, sensors: sensors.value })
          .then(() => (saveError.value = null))
          .catch((e: Error) => (saveError.value = e.message));
      }, SAVE_DELAY_MS);
    },
    { deep: true },
  );

  // Audio sensors without a hand-set noise level get one from the map; again after a move
  const classifiedAt = new Map<number, string>();
  watch(
    sensors,
    (list) => {
      for (const s of list) {
        const at = `${s.lat},${s.lng}`;
        if (s.type !== "audio" || s.noise || classifiedAt.get(s.id) === at) continue;
        classifiedAt.set(s.id, at);
        const { id, lat, lng } = s;
        noiseAt(lat, lng).then((n) => {
          if (!n) return void classifiedAt.delete(id); // tiles failed: retry on the next change
          // The plan may have been replaced or the sensor moved meanwhile
          const cur = sensors.value.find((x) => x.id === id && x.lat === lat && x.lng === lng);
          if (cur) cur.autoNoise = n;
        });
      }
    },
    { deep: true, immediate: true },
  );

  function replace(plan: Plan) {
    name.value = plan.name;
    sensors.value = plan.sensors;
  }

  loadRemote()
    .then((plan) => plan && replace(plan))
    .catch((e: Error) => (saveError.value = e.message));

  return {
    name,
    sensors,
    saveError,
    replace,
    add(type: SensorType, lat: number, lng: number) {
      sensors.value.push({ id: nextId(), type, lat, lng });
    },
    move(id: number, lat: number, lng: number) {
      const s = sensors.value.find((s) => s.id === id);
      if (s) Object.assign(s, { lat, lng });
    },
    setMast(id: number, m: number) {
      const s = sensors.value.find((s) => s.id === id);
      if (s) s.mastM = m;
    },
    setNoise(id: number, n: Noise | undefined) {
      const s = sensors.value.find((s) => s.id === id);
      if (s) s.noise = n; // undefined: back to the map's guess
    },
    remove(id: number) {
      sensors.value = sensors.value.filter((s) => s.id !== id);
    },
    clear() {
      sensors.value = [];
    },
  };
}
