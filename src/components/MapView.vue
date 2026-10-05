<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import type { Detection, Detections, PathPoint } from "../types";
import { colorFor } from "../colors";
import { copyText, esc } from "../export";
import { validPos } from "../geo";
import { FADE_SECONDS, GAP_SECONDS, MAX_ALT_M, STALE_SECONDS } from "../config";
import { REPLAY_PREFIX } from "../composables/useReplay";
import {
  RESTRICTION_LABEL,
  type Restriction,
  type Zone,
  type ZoneCheck,
} from "../zones";

const props = defineProps<{
  detections: Detections;
  zones: Zone[];
  checks: Record<string, ZoneCheck>;
  following: string | null;
}>();
const emit = defineEmits<{ unfollow: [] }>();

interface PopupView {
  el: HTMLElement;
  set: (d: Detection, check?: ZoneCheck) => void;
}

interface Track {
  drone?: L.Marker;
  pilot?: L.Marker;
  dronePopup: PopupView;
  pilotPopup: PopupView;
  dronePath: L.Polyline; // one line per stretch with data
  gapPath: L.Polyline; // dashed links across signal gaps
  pilotPath: L.Polyline;
  last?: PathPoint; // newest drone path point
}

const el = ref<HTMLDivElement>();
let map: L.Map | null = null;
let zoomedToFirst = false;
let moving = false; // true while the map is panning/zooming
let pending: Detections | null = null; // latest data received mid-move
let layersControl: L.Control.Layers | null = null;
let zonesLayer: L.GeoJSON | null = null;
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

// Popup built once as DOM; values are updated in place so it stays live while open
function createPopup(kind: "drone" | "pilot"): PopupView {
  const el = document.createElement("div");
  el.className = "rid-popup";
  el.innerHTML = `
    <b>${kind === "drone" ? "Drone" : "Pilot"}</b>
    <div class="line">ID: <code data-f="id"></code><button class=copyBtn data-copy="id" title="Copy ID">⧉</button></div>
    <div>RSSI: <span data-f="rssi"></span> dBm</div>
    ${kind === "drone" ? '<div>Alt: <span data-f="alt"></span> m</div><div>Speed: <span data-f="speed"></span></div>' : ""}
    <div class="line"><code data-f="pos"></code><button class=copyBtn data-copy="pos" title="Copy coordinates">⧉</button></div>
    ${kind === "drone" ? '<div class="zones" data-f="zones"></div>' : ""}`;

  const field = (name: string) =>
    el.querySelector<HTMLElement>(`[data-f="${name}"]`);

  el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await copyText(field(btn.dataset.copy!)?.textContent ?? "");
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "⧉"), 1000);
    });
  });

  function set(d: Detection, check?: ZoneCheck) {
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
      renderZones(field("zones")!, check);
    }
  }

  return { el, set };
}

// Zone status block in the drone popup
function renderZones(el: HTMLElement, check?: ZoneCheck) {
  if (!check) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  const rows = check.zones.map(
    (z) =>
      `<div class="zrow ${z.restriction}">${esc(RESTRICTION_LABEL[z.restriction])} · <b>${esc(z.name)}</b> · ${z.lowerM}–${z.upperM} m</div>`,
  );
  if (check.aboveMax)
    rows.push(`<div class="zrow above">Above ${MAX_ALT_M} m limit</div>`);
  if (!rows.length) rows.push('<div class="zrow ok">No zone</div>');
  el.innerHTML = rows.join("");
}

const ZONE_STYLE: Record<Restriction, L.PathOptions> = {
  PROHIBITED: { color: "#dc2626", weight: 1.5, fillOpacity: 0.15 },
  REQ_AUTHORISATION: { color: "#d97706", weight: 1, fillOpacity: 0.08 },
  NO_RESTRICTION: {
    color: "#6b7280",
    weight: 1,
    fillOpacity: 0.05,
    dashArray: "4,4",
  },
};

function zonePopup(z: Zone): string {
  const when = z.temporary
    ? z.applicability
        .map((a) =>
          esc(
            `${a.startDateTime?.slice(0, 16).replace("T", " ")} – ${a.endDateTime?.slice(0, 16).replace("T", " ")} UTC`,
          ),
        )
        .join("<br>")
    : "Permanent";
  return `<div class="rid-popup">
    <b>${esc(z.name)}</b>
    <div>${esc(RESTRICTION_LABEL[z.restriction])}${z.reason ? ` · ${esc(z.reason)}` : ""}</div>
    <div>${esc(z.lowerText)} – ${esc(z.upperText)}</div>
    <div>${when}</div>
    ${z.message ? `<div class="zmsg">${esc(z.message)}</div>` : ""}
  </div>`;
}

function renderZoneLayer(zones: Zone[]) {
  if (!map) return;
  if (!zonesLayer) {
    map.createPane("zones").style.zIndex = "350"; // below drone paths and markers
    const opts: L.GeoJSONOptions & { renderer: L.Renderer } = {
      pane: "zones",
      renderer: L.svg({ pane: "zones", padding: 2 }), // passed on to each polygon
      style: (f) =>
        ZONE_STYLE[(f?.properties as Zone).restriction] ??
        ZONE_STYLE.NO_RESTRICTION,
      onEachFeature: (f, layer) =>
        layer.bindPopup(zonePopup(f.properties as Zone), { maxWidth: 320 }),
    };
    zonesLayer = L.geoJSON(undefined, opts).addTo(map);
    layersControl?.addOverlay(zonesLayer, "Drone zones");
  }
  zonesLayer.clearLayers();
  for (const z of zones) {
    zonesLayer.addData({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: z.rings },
      properties: z,
    } as GeoJSON.Feature);
  }
}

function upsertMarker(
  existing: L.Marker | undefined,
  pos: L.LatLngTuple,
  icon: L.DivIcon,
  popup: PopupView,
  d: Detection,
  check?: ZoneCheck,
): L.Marker {
  popup.set(d, check);
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

const GAP_MS = GAP_SECONDS * 1000;

// Rebuild a drone path, breaking it into a dashed link wherever data stopped for a while
function drawPath(t: Track, pts: PathPoint[]) {
  const lines: L.LatLngTuple[][] = [[]];
  const gaps: L.LatLngTuple[][] = [];
  pts.forEach((p, i) => {
    const prev = pts[i - 1];
    if (prev && p[2] - prev[2] > GAP_MS) {
      gaps.push([[prev[0], prev[1]], [p[0], p[1]]]);
      lines.push([]);
    }
    lines[lines.length - 1].push([p[0], p[1]]);
  });
  t.dronePath.setLatLngs(lines);
  t.gapPath.setLatLngs(gaps);
  t.last = pts[pts.length - 1];
}

function appendDronePath(t: Track, p: PathPoint) {
  const last = t.last;
  t.last = p; // also when hovering in place, so the time keeps up
  if (last && last[0] === p[0] && last[1] === p[1]) return;
  const lines = t.dronePath.getLatLngs() as L.LatLng[][];
  if (last && p[2] - last[2] > GAP_MS) {
    const gaps = t.gapPath.getLatLngs() as L.LatLng[][];
    gaps.push([L.latLng(last[0], last[1]), L.latLng(p[0], p[1])]);
    t.gapPath.setLatLngs(gaps);
    lines.push([L.latLng(p[0], p[1])]);
    t.dronePath.setLatLngs(lines);
  } else t.dronePath.addLatLng([p[0], p[1]], lines[lines.length - 1]);
}

function removeTrack(id: string) {
  const t = tracks.get(id);
  if (!t) return;
  t.drone?.remove();
  t.pilot?.remove();
  t.dronePath.remove();
  t.gapPath.remove();
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
    if (!d.last_update || now - d.last_update > STALE_SECONDS) {
      removeTrack(id);
      continue;
    }

    const faded = now - d.last_update > FADE_SECONDS;
    const color = colorFor(id);
    let t = tracks.get(id);
    if (!t) {
      t = {
        dronePath: L.polyline([], { color, weight: 3 }).addTo(map),
        gapPath: L.polyline([], { color, weight: 2, dashArray: "2,6" }).addTo(
          map,
        ),
        pilotPath: L.polyline([], { color, weight: 2, dashArray: "5,5" }).addTo(
          map,
        ),
        dronePopup: createPopup("drone"),
        pilotPopup: createPopup("pilot"),
      };
      tracks.set(id, t);
      drawPath(t, pendingPaths.get(id) ?? []);
      pendingPaths.delete(id);
    }

    if (validPos(d.drone_lat, d.drone_long)) {
      const pos: L.LatLngTuple = [d.drone_lat, d.drone_long];
      t.drone = upsertMarker(
        t.drone,
        pos,
        droneIcon(color),
        t.dronePopup,
        d,
        props.checks[id],
      );
      // Replayed paths are set by the replay (setPath), in recording time
      if (!id.startsWith(REPLAY_PREFIX))
        appendDronePath(t, [pos[0], pos[1], d.last_update * 1000]);
      if (id === props.following) followPos = pos;
      if (!zoomedToFirst) {
        zoomedToFirst = true;
        map.setView(pos, 15);
      }
    }

    if (validPos(d.pilot_lat, d.pilot_long)) {
      const pos: L.LatLngTuple = [d.pilot_lat, d.pilot_long];
      t.pilot = upsertMarker(t.pilot, pos, pilotIcon(color), t.pilotPopup, d);
      appendPath(t.pilotPath, pos);
    }

    // Grey out drones that stopped updating
    t.drone?.setOpacity(faded ? 0.4 : 1);
    t.pilot?.setOpacity(faded ? 0.4 : 1);
    t.dronePath.setStyle({ opacity: faded ? 0.3 : 1 });
    t.gapPath.setStyle({ opacity: faded ? 0.3 : 0.8 });
    t.pilotPath.setStyle({ opacity: faded ? 0.3 : 1 });
  }

  if (followPos) map.panTo(followPos, { animate: true, duration: 0.5 });
}

// Pan/zoom to a drone and open its popup. Returns false if the drone isn't on the map yet.
function focus(id: string): boolean {
  const m = tracks.get(id)?.drone;
  if (!map || !m) return false;
  map.once("moveend", () => m.openPopup()); // opening mid-flight triggers autoPan
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
  return true;
}

// Replace a drone's path (replay, or live history after a reload). If the drone isn't on the
// map yet, or the map is mid-animation (redrawing then draws at the wrong offset), it's applied later.
const pendingPaths = new Map<string, PathPoint[]>();
function setPath(id: string, points: PathPoint[]) {
  const t = tracks.get(id);
  if (t && !moving) drawPath(t, points);
  else pendingPaths.set(id, points);
}

defineExpose({ focus, setPath });

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
  layersControl = L.control
    .layers({ Map: osm, Satellite: satellite }, undefined, {
      position: "bottomright",
    })
    .addTo(map);
  if (props.zones.length) renderZoneLayer(props.zones);
  map.on("dragstart", () => {
    if (props.following) emit("unfollow"); // manual pan cancels follow
  });
  map.on("movestart", () => (moving = true));
  map.on("moveend", () => {
    moving = false;
    for (const [id, pts] of pendingPaths) {
      const t = tracks.get(id);
      if (!t) continue;
      drawPath(t, pts);
      pendingPaths.delete(id);
    }
    if (pending) {
      const d = pending;
      pending = null;
      update(d);
    }
  });
  update(props.detections);
});

watch(() => props.detections, update);
watch(() => props.zones, renderZoneLayer);

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
  border-radius: 4px;
  font-size: 16px;
  color: #4b5563;
}
:deep(.rid-popup button:hover) {
  background: #e5e7eb;
  color: #111827;
}
:deep(.rid-popup .zones) {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #e5e7eb;
}
:deep(.rid-popup .zrow) {
  padding-left: 8px;
  border-left: 3px solid #9ca3af;
  margin: 2px 0;
}
:deep(.rid-popup .zrow.PROHIBITED) {
  border-color: #dc2626;
  color: #b91c1c;
}
:deep(.rid-popup .zrow.REQ_AUTHORISATION) {
  border-color: #d97706;
  color: #92400e;
}
:deep(.rid-popup .zrow.above) {
  border-color: #d97706;
  color: #92400e;
}
:deep(.rid-popup .zrow.ok) {
  border-color: #16a34a;
  color: #166534;
}
:deep(.rid-popup .zmsg) {
  margin-top: 4px;
  font-size: 12px;
  color: #4b5563;
  max-height: 120px;
  overflow-y: auto;
}
</style>
