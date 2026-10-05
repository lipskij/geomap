import { watch, type Ref } from "vue";
import type { Detections } from "../types";
import { validPos } from "../geo";

export interface TrackPoint {
  t: number; // unix seconds
  lat: number;
  lng: number;
  alt: number;
  speed: number; // m/s
  rssi: number;
  pilotLat: number;
  pilotLng: number;
}

const MAX_POINTS = 10_000; // per drone
const SAVE_MS = 5000;
const KEEP_SECONDS = 24 * 3600; // tracks without updates for longer are dropped on load
const DB_NAME = "geomap";
const STORE = "tracks"; // key: drone ID, value: TrackPoint[]

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

// Keeps every received drone position (independent of the map) for export and stats.
// Saved to IndexedDB so it survives page reloads.
export function useTrackHistory(detections: Ref<Detections>) {
  const history = new Map<string, TrackPoint[]>();
  const dirty = new Set<string>();

  watch(detections, (dets) => {
    for (const d of Object.values(dets)) {
      if (!d.last_update || !validPos(d.drone_lat, d.drone_long)) continue;
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
        pilotLat: d.pilot_lat,
        pilotLng: d.pilot_long,
      });
      if (pts.length > MAX_POINTS) pts.shift();
      dirty.add(d.basic_id);
    }
  });

  // Resolves once saved tracks are merged in (also when storage is unavailable)
  const loaded = (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      const minT = Date.now() / 1000 - KEEP_SECONDS;
      tx.objectStore(STORE).openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) return;
        const saved: TrackPoint[] = cursor.value;
        const id = String(cursor.key);
        if (!saved.length || saved[saved.length - 1].t < minT) cursor.delete();
        else {
          // Points received before loading finished come after the saved ones
          const lastT = saved[saved.length - 1].t;
          const fresh = (history.get(id) ?? []).filter((p) => p.t > lastT);
          history.set(id, [...saved, ...fresh].slice(-MAX_POINTS));
        }
        cursor.continue();
      };
      await done(tx);

      setInterval(() => {
        if (!dirty.size) return;
        const tx = db.transaction(STORE, "readwrite");
        for (const id of dirty) tx.objectStore(STORE).put(history.get(id), id);
        dirty.clear();
      }, SAVE_MS);
    } catch {
      // Private mode / blocked storage: history stays in memory only
    }
  })();

  return {
    getTrack: (id: string) => history.get(id) ?? [],
    trackIds: () => [...history.keys()],
    loaded,
  };
}
