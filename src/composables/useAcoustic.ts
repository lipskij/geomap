import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue";
import { fetchBearings } from "../api";
import { crossBearings, headingOf, type AcousticTrack, type Bearing, type Fix } from "../acoustic";
import { FADE_SECONDS, POLL_MS } from "../config";
import type { Sensor } from "./useSensors";

export const ACOUSTIC_ID = "acoustic"; // its id in toasts and the alert log
const WINDOW_MS = 2000; // bearings this close in time count as the same moment
const HEADING_FIXES = 8; // heading from the last this many fixes

// ponytail: one acoustic target at a time; telling two drones apart needs bearing association
export function useAcoustic(sensors: Ref<Sensor[]>, onNewTarget: (sensors: number) => void) {
  const track = shallowRef<AcousticTrack | null>(null);
  const hearing = shallowRef<Bearing[]>([]); // every audio sensor hearing it now, even alone
  let fixes: Fix[] = [];
  const latest = new Map<number, Bearing>(); // newest bearing per sensor
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function tick() {
    try {
      for (const b of await fetchBearings()) latest.set(b.sensorId, b);
    } catch {
      // ponytail: no feed yet; surface errors like detections do once there is one
    }
    const now = Date.now();
    const audio = new Map(sensors.value.map((s) => [s.id, s])); // bearing sensors only
    // One sensor alone shows nothing: only crossings of 2+ bearings make a fix
    const recent = [...latest.values()].filter(
      (b) => audio.has(b.sensorId) && now - b.t <= WINDOW_MS,
    );
    hearing.value = recent;
    const fix = crossBearings(recent, audio);
    if (fix && fix.t > (fixes[fixes.length - 1]?.t ?? 0)) {
      if (!fixes.length) onNewTarget(fix.sensors);
      fixes = [...fixes, fix].slice(-HEADING_FIXES);
    }
    if (fixes.length && now - fixes[fixes.length - 1].t > FADE_SECONDS * 1000) fixes = [];
    track.value = fixes.length
      ? { bearings: fix ? recent : [], fixes, heading: headingOf(fixes) }
      : null;
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  }

  onMounted(tick);
  onBeforeUnmount(() => {
    stopped = true;
    clearTimeout(timer);
  });

  return { track, hearing };
}
