import { watch, type Ref } from "vue";
import type { Detections } from "../types";

export interface TrackPoint {
  t: number; // unix seconds
  lat: number;
  lng: number;
  alt: number;
  speed: number; // m/s
  rssi: number;
}

const MAX_POINTS = 10_000; // per drone

// Keeps every received drone position (independent of the map) for export
export function useTrackHistory(detections: Ref<Detections>) {
  const history = new Map<string, TrackPoint[]>();

  watch(detections, (dets) => {
    for (const d of Object.values(dets)) {
      if (!d.last_update || (d.drone_lat === 0 && d.drone_long === 0)) continue;
      let pts = history.get(d.basic_id);
      if (!pts) history.set(d.basic_id, (pts = []));
      if (pts.length && pts[pts.length - 1].t === d.last_update) continue; // no new data
      pts.push({
        t: d.last_update,
        lat: d.drone_lat,
        lng: d.drone_long,
        alt: d.drone_altitude,
        speed: d.drone_speed,
        rssi: d.rssi,
      });
      if (pts.length > MAX_POINTS) pts.shift();
    }
  });

  return { getTrack: (id: string) => history.get(id) ?? [] };
}
