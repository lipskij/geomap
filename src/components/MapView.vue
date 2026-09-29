<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import type { Detection, Detections } from "../types";
import { colorFor } from "../colors";

const props = withDefaults(
  defineProps<{
    detections: Detections;
    following?: string | null;
    fadeSeconds?: number;
    staleSeconds?: number;
  }>(),
  { following: null, fadeSeconds: 10, staleSeconds: 60 },
);
const emit = defineEmits<{ unfollow: [] }>();

interface PopupView {
  el: HTMLElement;
  set: (d: Detection) => void;
}

interface Track {
  drone?: L.Marker;
  pilot?: L.Marker;
  dronePopup: PopupView;
  pilotPopup: PopupView;
  dronePath: L.Polyline;
  pilotPath: L.Polyline;
}

const el = ref<HTMLDivElement>();
let map: L.Map | null = null;
let zoomedToFirst = false;
let moving = false; // true while the map is panning/zooming
let pending: Detections | null = null; // latest data received mid-move
const tracks = new Map<string, Track>();

function droneIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "rid-icon",
    iconSize: [54, 54],
    iconAnchor: [27, 27],
    popupAnchor: [0, -20],
    html: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-11 -11 54 54" width="54" height="54">
  <g stroke="#1f2937" stroke-width="2" stroke-linecap="round">
    <line x1="8" y1="8" x2="24" y2="24"/><line x1="24" y1="8" x2="8" y2="24"/>
  </g>
  <g fill="#e5e7eb" fill-opacity="0.85" stroke="#1f2937" stroke-width="1.5">
    <circle cx="7" cy="7" r="5"/><circle cx="25" cy="7" r="5"/>
    <circle cx="7" cy="25" r="5"/><circle cx="25" cy="25" r="5"/>
  </g>
  <rect x="12" y="12" width="8" height="8" rx="2" fill="${color}" stroke="#1f2937" stroke-width="1.5"/>
  <g class="heading" style="display:none">
    <polygon points="16,-10 11.5,-4 20.5,-4" fill="${color}" stroke="#1f2937" stroke-width="1.2" stroke-linejoin="round"/>
  </g>
</svg>`,
  });
}

// Rotate the arrow in place (no icon rebuild); hidden when the source has no heading
function setHeading(marker: L.Marker, heading: number | undefined) {
  const g = marker.getElement()?.querySelector<SVGGElement>(".heading");
  if (!g) return;
  if (heading === undefined || !Number.isFinite(heading)) {
    g.style.display = "none";
    return;
  }
  g.style.display = "";
  g.setAttribute("transform", `rotate(${heading} 16 16)`); // rotate around drone center
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

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure contexts (plain http on LAN)
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

// Popup built once as DOM; values are updated in place so it stays live while open
function createPopup(kind: "drone" | "pilot"): PopupView {
  const el = document.createElement("div");
  el.className = "rid-popup";
  el.innerHTML = `
    <b>${kind === "drone" ? "Drone" : "Pilot"}</b>
    <div class="line">ID: <code data-f="id"></code><button data-copy="id" title="Copy ID">⧉</button></div>
    <div>RSSI: <span data-f="rssi"></span> dBm</div>
    ${kind === "drone" ? '<div>Alt: <span data-f="alt"></span> m</div><div>Speed: <span data-f="speed"></span></div><div data-f="hdg-line">Heading: <span data-f="hdg"></span>°</div>' : ""}
    <div class="line"><code data-f="pos"></code><button data-copy="pos" title="Copy coordinates">⧉</button></div>`;

  const field = (name: string) =>
    el.querySelector<HTMLElement>(`[data-f="${name}"]`);

  el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await copyText(field(btn.dataset.copy!)?.textContent ?? "");
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "⧉"), 1000);
    });
  });

  function set(d: Detection) {
    const [lat, lng] =
      kind === "drone"
        ? [d.drone_lat, d.drone_long]
        : [d.pilot_lat, d.pilot_long];
    field("id")!.textContent = d.basic_id;
    field("rssi")!.textContent = String(d.rssi);
    field("pos")!.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    if (kind === "drone") {
      field("alt")!.textContent = String(d.drone_altitude);
      field("speed")!.textContent =
        `${(d.drone_speed * 3.6).toFixed(0)} km/h (${d.drone_speed.toFixed(1)} m/s)`;
      const hasHdg = d.drone_heading !== undefined;
      field("hdg-line")!.style.display = hasHdg ? "" : "none";
      if (hasHdg)
        field("hdg")!.textContent = String(Math.round(d.drone_heading!));
    }
  }

  return { el, set };
}

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

function upsertMarker(
  existing: L.Marker | undefined,
  pos: L.LatLngTuple,
  icon: L.DivIcon,
  popup: PopupView,
  d: Detection,
): L.Marker {
  popup.set(d);
  if (existing) {
    existing.setLatLng(pos);
    return existing;
  }
  return L.marker(pos, { icon }).bindPopup(popup.el).addTo(map!);
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
  // Redrawing paths mid-animation draws them at the wrong offset; wait for moveend
  if (moving) {
    pending = detections;
    return;
  }
  const now = Date.now() / 1000;

  // Drop tracks no longer present in the response
  for (const id of tracks.keys()) if (!(id in detections)) removeTrack(id);

  let followPos: L.LatLngTuple | null = null;

  for (const [id, d] of Object.entries(detections)) {
    if (!d.last_update || now - d.last_update > props.staleSeconds) {
      removeTrack(id);
      continue;
    }

    const faded = now - d.last_update > props.fadeSeconds;
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
        dronePopup: createPopup("drone"),
        pilotPopup: createPopup("pilot"),
      };
      tracks.set(id, t);
    }

    if (valid(d.drone_lat, d.drone_long)) {
      const pos: L.LatLngTuple = [d.drone_lat, d.drone_long];
      t.drone = upsertMarker(t.drone, pos, droneIcon(color), t.dronePopup, d);
      setHeading(t.drone, d.drone_heading);
      appendPath(t.dronePath, pos);
      if (id === props.following) followPos = pos;
      if (!zoomedToFirst) {
        zoomedToFirst = true;
        map.setView(pos, 15);
      }
    }

    if (valid(d.pilot_lat, d.pilot_long)) {
      const pos: L.LatLngTuple = [d.pilot_lat, d.pilot_long];
      t.pilot = upsertMarker(t.pilot, pos, pilotIcon(color), t.pilotPopup, d);
      appendPath(t.pilotPath, pos);
    }

    // Grey out drones that stopped updating
    t.drone?.setOpacity(faded ? 0.4 : 1);
    t.pilot?.setOpacity(faded ? 0.4 : 1);
    t.dronePath.setStyle({ opacity: faded ? 0.3 : 0.5 });
    t.pilotPath.setStyle({ opacity: faded ? 0.3 : 1 });
  }

  if (followPos) map.panTo(followPos, { animate: true, duration: 0.5 });
}

// Pan/zoom to a drone and open its popup
function focus(id: string) {
  const m = tracks.get(id)?.drone;
  if (!map || !m) return;
  map.once("moveend", () => m.openPopup()); // opening mid-flight triggers autoPan
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
}

defineExpose({ focus });

onMounted(() => {
  map = L.map(el.value!, {
    // Draw paths well beyond the viewport so they aren't cut off while flying between drones
    renderer: L.svg({ padding: 2 }),
  }).setView([54.69, 25.28], 7);
  const osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    },
  );
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles &copy; Esri" },
  );

  osm.addTo(map);
  L.control
    .layers({ Map: osm, Satellite: satellite }, undefined, {
      position: "bottomright",
    })
    .addTo(map);
  map.on("dragstart", () => {
    if (props.following) emit("unfollow"); // manual pan cancels follow
  });
  map.on("movestart", () => (moving = true));
  map.on("moveend", () => {
    moving = false;
    if (pending) {
      const d = pending;
      pending = null;
      update(d);
    }
  });
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
:deep(.rid-popup) {
  font-size: 13px;
  line-height: 1.5;
}
:deep(.rid-popup .line) {
  display: flex;
  align-items: center;
  gap: 4px;
}
:deep(.rid-popup code) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  user-select: all;
}
:deep(.rid-popup button) {
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0 4px;
  font-size: 14px;
  color: #0f63da;
}
:deep(.rid-popup button:hover) {
  color: #111827;
}
</style>
