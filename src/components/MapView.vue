<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import type { Detection, Detections } from "../types";
import { colorFor } from "../colors";

const props = withDefaults(
  defineProps<{ detections: Detections; staleSeconds?: number }>(),
  { staleSeconds: 60 },
);

interface Track {
  drone?: L.Marker;
  pilot?: L.Marker;
  dronePath: L.Polyline;
  pilotPath: L.Polyline;
}

const el = ref<HTMLDivElement>();
let map: L.Map | null = null;
let zoomedToFirst = false;
const tracks = new Map<string, Track>();

function droneIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "rid-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
    html: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <g stroke="#1f2937" stroke-width="2" stroke-linecap="round">
    <line x1="8" y1="8" x2="24" y2="24"/><line x1="24" y1="8" x2="8" y2="24"/>
  </g>
  <g fill="#e5e7eb" fill-opacity="0.85" stroke="#1f2937" stroke-width="1.5">
    <circle cx="7" cy="7" r="5"/><circle cx="25" cy="7" r="5"/>
    <circle cx="7" cy="25" r="5"/><circle cx="25" cy="25" r="5"/>
  </g>
  <rect x="12" y="12" width="8" height="8" rx="2" fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
</svg>`,
  });
}

function pilotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "rid-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
    html: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="22" height="22">
  <circle cx="11" cy="11" r="10" fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
  <circle cx="11" cy="8" r="3" fill="#fff"/>
  <path d="M5.5 17c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5" fill="#fff"/>
</svg>`,
  });
}

function popup(d: Detection, kind: "drone" | "pilot"): string {
  const [lat, lng] =
    kind === "drone"
      ? [d.drone_lat, d.drone_long]
      : [d.pilot_lat, d.pilot_long];
  return `<b>${kind === "drone" ? "Drone" : "Pilot"}</b><br>
ID: ${d.basic_id}<br>RSSI: ${d.rssi} dBm<br>
${kind === "drone" ? `Alt: ${d.drone_altitude} m<br>Speed: ${d.drone_speed.toFixed(1)} m/s (${(d.drone_speed * 3.6).toFixed(0)} km/h)<br>` : ""}
${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

function upsertMarker(
  existing: L.Marker | undefined,
  pos: L.LatLngTuple,
  icon: L.DivIcon,
  html: string,
): L.Marker {
  if (existing) {
    existing.setLatLng(pos);
    if (!existing.isPopupOpen()) existing.setPopupContent(html);
    return existing;
  }
  return L.marker(pos, { icon }).bindPopup(html).addTo(map!);
}

function appendPath(path: L.Polyline, pos: L.LatLngTuple) {
  const pts = path.getLatLngs() as L.LatLng[];
  const last = pts[pts.length - 1];
  if (!last || last.lat !== pos[0] || last.lng !== pos[1]) path.addLatLng(pos);
}

function removeTrack(id: string) {
  const t = tracks.get(id);
  if (!t) return;
  t.drone?.remove();
  t.pilot?.remove();
  t.dronePath.remove();
  t.pilotPath.remove();
  tracks.delete(id);
}

function update(detections: Detections) {
  if (!map) return;
  const now = Date.now() / 1000;

  // Drop tracks no longer present in the response
  for (const id of tracks.keys()) if (!(id in detections)) removeTrack(id);

  for (const [id, d] of Object.entries(detections)) {
    if (!d.last_update || now - d.last_update > props.staleSeconds) {
      removeTrack(id);
      continue;
    }

    const color = colorFor(id);
    let t = tracks.get(id);
    if (!t) {
      t = {
        dronePath: L.polyline([], { color, weight: 3, opacity: 0.5 }).addTo(
          map,
        ),
        pilotPath: L.polyline([], { color, weight: 2, dashArray: "5,5" }).addTo(
          map,
        ),
      };
      tracks.set(id, t);
    }

    if (valid(d.drone_lat, d.drone_long)) {
      const pos: L.LatLngTuple = [d.drone_lat, d.drone_long];
      t.drone = upsertMarker(t.drone, pos, droneIcon(color), popup(d, "drone"));
      appendPath(t.dronePath, pos);
      if (!zoomedToFirst) {
        zoomedToFirst = true;
        map.setView(pos, 15);
      }
    }

    if (valid(d.pilot_lat, d.pilot_long)) {
      const pos: L.LatLngTuple = [d.pilot_lat, d.pilot_long];
      t.pilot = upsertMarker(t.pilot, pos, pilotIcon(color), popup(d, "pilot"));
      appendPath(t.pilotPath, pos);
    }
  }
}

function focus(id: string) {
  const m = tracks.get(id)?.drone;
  if (!map || !m) return;
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
  m.openPopup();
}

defineExpose({ focus });

onMounted(() => {
  map = L.map(el.value!).setView([54.69, 25.28], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  update(props.detections);
});

watch(() => props.detections, update);

onBeforeUnmount(() => {
  tracks.clear();
  map?.remove();
  map = null;
});
</script>

<template>
  <div ref="el" class="map" />
</template>

<style scoped>
.map {
  width: 100%;
  height: 100%;
}
:deep(.rid-icon) {
  background: none;
  border: none;
}
</style>
