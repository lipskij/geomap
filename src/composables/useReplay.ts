import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import type { Detections } from "../types";
import {
  parseTrackFile,
  type ReplayPoint,
  type ReplayTrack,
} from "../replay/parse";

const TICK_MS = 250;
export const REPLAY_PREFIX = "R-"; // replayed IDs are prefixed so they never collide with live ones

const R = 6_371_000; // earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;

function distanceM(a: ReplayPoint, b: ReplayPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a: ReplayPoint, b: ReplayPoint): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
  const ids = computed(() => tracks.value.map((t) => REPLAY_PREFIX + t.id));

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
      const seg = ended ? pts[i - 1] : a; // segment used for speed / heading
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
        drone_heading: a.heading ?? bearing(seg, segEnd),
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
  function pathsAtPosition(): Record<string, [number, number][]> {
    const abs = start.value + position.value;
    const out: Record<string, [number, number][]> = {};
    for (const track of tracks.value) {
      const id = REPLAY_PREFIX + track.id;
      const pts: [number, number][] = track.points
        .filter((p) => p.t <= abs)
        .map((p) => [p.lat, p.lng]);
      const d = detections.value[id];
      if (d) pts.push([d.drone_lat, d.drone_long]); // current (interpolated) position
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
    ids,
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
