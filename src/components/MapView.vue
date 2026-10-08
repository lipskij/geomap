<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import type { Detection, Detections, PathPoint } from "../types";
import { colorFor } from "../colors";
import { copyText, esc } from "../export";
import { fmtPos, validPos } from "../geo";
import { FADE_SECONDS, GAP_SECONDS, MAX_ALT_M, STALE_SECONDS } from "../config";
import { REPLAY_PREFIX } from "../composables/useReplay";
import type { Restriction, Zone, ZoneCheck } from "../zones";
import { lang, t, type MsgKey } from "../i18n";
import { ICONS } from "../icons";

export type BaseLayer = "light" | "dark" | "map" | "satellite";

const props = defineProps<{
  detections: Detections;
  zones: Zone[];
  checks: Record<string, ZoneCheck>;
  following: string | null;
  rightInset: number; // px of the map covered by the panel on the right
  base: BaseLayer;
  showZones: boolean;
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
let zonesLayer: L.GeoJSON | null = null;
let baseLayers: Record<BaseLayer, L.TileLayer> | null = null;

function showBase(key: BaseLayer) {
  if (!map || !baseLayers) return;
  for (const layer of Object.values(baseLayers)) layer.remove();
  baseLayers[key].addTo(map);
}

function showZoneLayer(on: boolean) {
  if (!map || !zonesLayer) return;
  if (on) zonesLayer.addTo(map);
  else zonesLayer.remove();
}
const tracks = new Map<string, Track>();

function droneIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "rid-icon",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
    html: `<span class="rid-marker" style="background:${color}"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS.drone}</svg></span>`,
  });
}

function pilotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "rid-icon",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
    html: `<span class="rid-marker pilot" style="background:${color}"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS.pilot}</svg></span>`,
  });
}

// Fill text of [data-l] elements and titles of [data-lt] elements in the current language
function applyLabels(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-l]").forEach((n) => {
    n.textContent = t(n.dataset.l as MsgKey);
  });
  root.querySelectorAll<HTMLElement>("[data-lt]").forEach((n) => {
    n.title = t(n.dataset.lt as MsgKey);
  });
}

// Popup built once as DOM; values are updated in place so it stays live while open
function createPopup(kind: "drone" | "pilot"): PopupView {
  const el = document.createElement("div");
  el.className = "rid-popup";
  el.innerHTML = `
    <b data-l="popup.${kind}"></b>
    <div class="line">ID: <code data-f="id"></code><button class=copyBtn data-copy="id" data-lt="copy.id"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS.copy}</svg></button></div>
    <div>RSSI: <span data-f="rssi"></span> dBm</div>
    ${kind === "drone" ? '<div><span data-l="popup.alt"></span>: <span data-f="alt"></span> m</div><div><span data-l="popup.speed"></span>: <span data-f="speed"></span></div>' : ""}
    <div class="line"><code data-f="pos"></code><button class=copyBtn data-copy="pos" data-lt="copy.coords"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS.copy}</svg></button></div>
    ${kind === "drone" ? '<div class="zones" data-f="zones"></div>' : ""}`;
  applyLabels(el);

  const field = (name: string) =>
    el.querySelector<HTMLElement>(`[data-f="${name}"]`);

  el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await copyText(field(btn.dataset.copy!)?.textContent ?? "");
      const icon = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${ICONS.check}</svg>`;
      setTimeout(() => (btn.innerHTML = icon), 1000);
    });
  });

  function set(d: Detection, check?: ZoneCheck) {
    const [lat, lng] =
      kind === "drone"
        ? [d.drone_lat, d.drone_long]
        : [d.pilot_lat, d.pilot_long];
    field("id")!.textContent = d.basic_id;
    field("rssi")!.textContent = String(d.rssi);
    field("pos")!.textContent = fmtPos(lat, lng);
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
      `<div class="zrow ${z.restriction}">${esc(t(`zone.${z.restriction}`))} · <b>${esc(z.name)}</b> · ${z.lowerM}–${z.upperM} m</div>`,
  );
  if (check.aboveMax)
    rows.push(
      `<div class="zrow above">${esc(t("popup.aboveLimit", { m: MAX_ALT_M }))}</div>`,
    );
  if (!rows.length) rows.push(`<div class="zrow ok">${esc(t("zone.none"))}</div>`);
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
    : esc(t("zone.permanent"));
  return `<div class="rid-popup">
    <b>${esc(z.name)}</b>
    <div>${esc(t(`zone.${z.restriction}`))}${z.reason ? ` · ${esc(z.reason)}` : ""}</div>
    <div>${esc(z.lowerText)} – ${esc(z.upperText)}</div>
    <div>${when}</div>
    ${z.message[lang.value] ? `<div class="zmsg">${esc(z.message[lang.value])}</div>` : ""}
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
    // Hidden unless switched on in the layers panel. Zone checks and alerts run either way
    zonesLayer = L.geoJSON(undefined, opts);
    showZoneLayer(props.showZones);
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
  return L.marker(pos, { icon })
    .bindPopup(popup.el, { autoPanPaddingBottomRight: [inset() + 10, 10] })
    .addTo(map!);
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
  let followLift = 0;

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
      if (id === props.following) {
        followPos = pos;
        followLift = popupLift(t.drone);
      }
      if (!zoomedToFirst) {
        zoomedToFirst = true;
        map.setView(visibleCenter(pos, 15), 15);
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

  if (followPos)
    map.panTo(visibleCenter(followPos, map.getZoom(), followLift), {
      animate: true,
      duration: 0.5,
    });
}

// Covered width, capped so narrow screens (panel over most of the map) still get a center
const inset = () => Math.min(props.rightInset, (map?.getSize().x ?? 0) / 2);

// Map center that puts `pos` in the middle of the part not covered by the panel.
// lift: px to place `pos` below the middle, so an open popup above it is centered too.
function visibleCenter(pos: L.LatLngExpression, zoom: number, lift = 0): L.LatLng {
  return map!.unproject(map!.project(pos, zoom).add([inset() / 2, -lift]), zoom);
}

// Half the height of the marker's open popup (0 when closed)
const popupLift = (m: L.Marker) =>
  m.isPopupOpen() ? (m.getPopup()?.getElement()?.offsetHeight ?? 0) / 2 : 0;

// Pan/zoom to a drone and open its popup. Returns false if the drone isn't on the map yet.
function focus(id: string): boolean {
  const m = tracks.get(id)?.drone;
  if (!map || !m) return false;
  // Open first without autoPan (it would jump the map after the flight), then fly so the
  // drone and its popup end up centered together
  const popup = m.getPopup()!;
  popup.options.autoPan = false;
  m.openPopup();
  popup.options.autoPan = true;
  const zoom = Math.max(map.getZoom(), 16);
  map.flyTo(visibleCenter(m.getLatLng(), zoom, popupLift(m)), zoom, {
    duration: 0.6,
  });
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
    zoomControl: false,
  }).setView([54.69, 25.28], 7);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const osm = (className?: string) =>
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
      className, // light/dark variants are OSM tiles recoloured in CSS, no tile key needed
    });
  baseLayers = {
    light: osm("light-tiles"),
    dark: osm("dark-tiles"),
    map: osm(),
    satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles &copy; Esri" },
    ),
  };
  showBase(props.base);
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
watch(() => props.base, showBase);
watch(() => props.showZones, showZoneLayer);

// Leaflet content is plain DOM: relabel it when the language changes
watch(lang, () => {
  for (const t of tracks.values()) {
    applyLabels(t.dronePopup.el);
    applyLabels(t.pilotPopup.el);
  }
  if (zonesLayer) renderZoneLayer(props.zones); // rebinds zone popups
  update(props.detections); // refreshes zone rows in drone popups
});

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
/* Drone / pilot marker: disc in the drone colour with a white glyph */
:deep(.rid-marker) {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2px solid #fff;
  border-radius: 50%;
  color: #fff;
  box-shadow: 0 2px 6px rgba(15, 30, 60, 0.35);
}
:deep(.rid-marker svg) {
  width: 62%;
  height: 62%;
}
:deep(.rid-popup) {
  font-size: 13px;
  line-height: 1.6;
}
:deep(.rid-popup b) {
  font-family: var(--font-head);
  font-size: 15px;
}
:deep(.rid-popup .line) {
  display: flex;
  align-items: center;
  gap: 4px;
}
:deep(.rid-popup code) {
  font-family: var(--font-mono);
  font-size: 12px;
  user-select: all;
}
:deep(.rid-popup button) {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  color: var(--muted);
}
:deep(.rid-popup button svg) {
  width: 14px;
  height: 14px;
}
:deep(.rid-popup button:hover) {
  background: var(--accent-soft);
  color: var(--accent);
}
:deep(.rid-popup .zones) {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
:deep(.rid-popup .zrow) {
  margin: 3px 0;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--hover);
}
:deep(.rid-popup .zrow.PROHIBITED) {
  background: var(--danger-bg);
  color: var(--danger);
}
:deep(.rid-popup .zrow.REQ_AUTHORISATION),
:deep(.rid-popup .zrow.above) {
  background: var(--warn-bg);
  color: var(--warn);
}
:deep(.rid-popup .zrow.ok) {
  background: var(--ok-bg);
  color: var(--ok);
}
:deep(.rid-popup .zmsg) {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
  max-height: 120px;
  overflow-y: auto;
}
</style>
