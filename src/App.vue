<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import MapView, { type BaseLayer } from "./components/MapView.vue";
import LayersPanel from "./components/LayersPanel.vue";
import DroneList from "./components/DroneList.vue";
import ToastStack from "./components/ToastStack.vue";
import ReplayPanel from "./components/ReplayPanel.vue";
import {
  REPLAY_PREFIX,
  trackStats,
  useReplay,
  type ZoneHitCache,
} from "./composables/useReplay";
import { useDetections } from "./composables/useDetections";
import { useTrackHistory } from "./composables/useTrackHistory";
import { useToasts } from "./composables/useToasts";
import { useZones } from "./composables/useZones";
import {
  checkPosition,
  isZoneActive,
  type Zone,
  type ZoneCheck,
} from "./zones";
import { exportTrack, type ExportFormat } from "./export";
import { MAX_ALT_M, POLL_MS, STALE_SECONDS, ZONES_ENABLED } from "./config";
import { t } from "./i18n";

const { detections: live, error } = useDetections(POLL_MS);
const replay = useReplay();

// While a replay is loaded, show only the replayed drones; otherwise live (or mock) ones
const detections = computed(() =>
  replay.fileName.value ? replay.detections.value : live.value,
);
// History keeps recording live drones even while a replay is shown
const { getTrack, trackIds, loaded: historyLoaded } = useTrackHistory(live);

// Draw recorded paths of drones still around (after a reload, or when a replay closes)
function redrawLivePaths() {
  const now = Date.now() / 1000;
  for (const id of trackIds()) {
    const pts = getTrack(id);
    if (!pts.length || now - pts[pts.length - 1].t > STALE_SECONDS) continue;
    mapView.value?.setPath(
      id,
      pts.map((p) => [p.lat, p.lng, p.t * 1000]),
    );
  }
}
historyLoaded.then(() => {
  if (!replay.fileName.value) redrawLivePaths();
});

// After loading a file, focus its first drone as soon as it's on the map.
// Closing a replay brings live drones back: redraw their paths from the recorded history
let focusAfterLoad = false;
watch(replay.tracks, (t) => {
  focusAfterLoad = t.length > 0;
  if (!t.length) redrawLivePaths();
});
watch(
  replay.detections,
  (dets) => {
    if (!focusAfterLoad) return;
    const id = Object.keys(dets)[0];
    if (id && focusDrone(id)) focusAfterLoad = false;
  },
  { flush: "post" }, // after the map has drawn the drone
);

// Replayed paths follow the recorded points up to the current time (also after seeking
// and at high speed), instead of joining sampled positions with straight lines
watch(replay.detections, () => {
  for (const [id, pts] of Object.entries(replay.pathsAtPosition()))
    mapView.value?.setPath(id, pts);
});

const replayStats = computed(() =>
  replay.tracks.value.map((t) =>
    trackStats(REPLAY_PREFIX + t.id, t.points, zones.value),
  ),
);

const mapView = ref<InstanceType<typeof MapView>>();
const base = ref<BaseLayer>("light");
const showZones = ref(false);
// Panels follow the base map: dark colours on the dark map, light ones otherwise
watch(
  base,
  (b) => (document.documentElement.dataset.theme = b === "dark" ? "dark" : "light"),
  { immediate: true },
);
const selected = ref<string | null>(null);
const following = ref<string | null>(null);

const activeDrones = computed(() => {
  const now = Date.now() / 1000;
  return Object.values(detections.value).filter(
    (d) => d.last_update && now - d.last_update <= STALE_SECONDS,
  );
});

const { toasts, dismiss, push, alerts, clearAlerts } = useToasts(activeDrones);
const { zones, error: zonesError } = useZones();

// Zones active right now. Re-checked every poll, but only replaced when the
// set changes, so the map doesn't redraw these layers every second.
const activeZones = shallowRef<Zone[]>([]);
let lastZones: Zone[] | null = null;
watch([zones, detections], () => {
  const next = zones.value.filter((z) => isZoneActive(z));
  const keys = (list: Zone[]) => list.map((z) => z.id).join("|");
  if (zones.value !== lastZones || keys(next) !== keys(activeZones.value))
    activeZones.value = next;
  lastZones = zones.value;
});

// Per-drone zone / altitude status (only when zone data is available)
const checks = computed<Record<string, ZoneCheck>>(() => {
  if (!ZONES_ENABLED || !activeZones.value.length) return {};
  const out: Record<string, ZoneCheck> = {};
  for (const d of activeDrones.value) {
    out[d.basic_id] = checkPosition(
      d.drone_lat,
      d.drone_long,
      d.drone_altitude,
      activeZones.value,
      MAX_ALT_M,
    );
  }
  return out;
});

// Alert when a drone enters a prohibited zone or goes above the altitude limit
const lastAlert = new Map<string, string>();
watch(checks, (all) => {
  for (const [id, c] of Object.entries(all)) {
    const prohibited = c.zones.find((z) => z.restriction === "PROHIBITED");
    const key = prohibited ? `p:${prohibited.id}` : c.aboveMax ? "above" : "";
    if (key && key !== lastAlert.get(id)) {
      if (prohibited)
        push(id, "msg.prohibited", { name: prohibited.name }, "alert");
      else push(id, "msg.above", { m: MAX_ALT_M }, "alert");
    }
    lastAlert.set(id, key);
  }
});

// Stop following a drone that has disappeared
watch(activeDrones, (list) => {
  if (following.value && !list.some((d) => d.basic_id === following.value))
    following.value = null;
});

function focusDrone(id: string): boolean {
  // Focusing another drone cancels follow, otherwise the map jumps between the two
  if (following.value && following.value !== id) following.value = null;
  selected.value = id;
  return mapView.value?.focus(id) ?? false;
}

function setFollow(id: string | null) {
  following.value = id;
  if (id) focusDrone(id);
}

// Live zone checks per drone, reused across polls; reset when the set of zones changes
// (the 5-min reload usually returns the same zones)
const zoneHits = new Map<string, ZoneHitCache>();
let zoneHitsKey = "";

// Replayed drone: whole-file stats. Live drone: from its recorded history (seconds → ms).
// live re-walks the whole history per poll (cheap without the zone checks); go incremental if it shows up
function statsFor(id: string) {
  if (replay.fileName.value)
    return replayStats.value.find((s) => s.id === id) ?? null;
  const pts = getTrack(id).map((p) => ({ ...p, t: p.t * 1000 }));
  if (!pts.length) return null;
  const key = zones.value.map((z) => z.id).join("|");
  if (key !== zoneHitsKey) {
    zoneHits.clear();
    zoneHitsKey = key;
  }
  if (!zoneHits.has(id)) zoneHits.set(id, new Map());
  return trackStats(id, pts, zones.value, zoneHits.get(id));
}

function onExport(id: string, format: ExportFormat) {
  exportTrack(id, getTrack(id), format);
}
</script>

<template>
  <p v-if="error" class="error">{{ t("err.detections", { e: error }) }}</p>
  <p v-else-if="zonesError" class="error">
    {{ t("err.zones", { e: zonesError }) }}
  </p>
  <!-- right-inset: drone panel is 320 px wide + 10 px margin, plus a 10 px gap -->
  <MapView
    ref="mapView"
    :detections="detections"
    :zones="activeZones"
    :checks="checks"
    :following="following"
    :right-inset="340"
    :base="base"
    :show-zones="showZones"
    @unfollow="following = null"
  />
  <LayersPanel
    v-model:base="base"
    v-model:show-zones="showZones"
    :zones-available="ZONES_ENABLED"
  />
  <DroneList
    :drones="activeDrones"
    :selected="selected"
    :following="following"
    :checks="checks"
    :stats-for="statsFor"
    :alerts="alerts"
    @select="focusDrone"
    @clear-alerts="clearAlerts"
    @follow="setFollow"
    @export="onExport"
  />
  <ToastStack :toasts="toasts" @select="focusDrone" @dismiss="dismiss" />
  <ReplayPanel
    :file-name="replay.fileName.value"
    :drone-count="replay.tracks.value.length"
    :playing="replay.playing.value"
    :speed="replay.speed.value"
    :position="replay.position.value"
    :duration="replay.duration.value"
    :error="replay.error.value"
    @load="replay.load"
    @toggle="replay.toggle"
    @seek="replay.seek"
    @speed="(v) => (replay.speed.value = v)"
    @close="replay.close"
  />
</template>

<style>
:root {
  --font: "Barlow", system-ui, sans-serif;
  --font-head: "Barlow Condensed", "Barlow", system-ui, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
  --font-size: 14px/1.35;
  --radius: 12px;
  --radius-lg: 18px;
  /* Light: white cards on a muted map, blue for actions, colour carries meaning */
  --map-bg: #e9edf1;
  --panel: #ffffff;
  --panel-solid: #ffffff;
  --shadow: 0 6px 24px rgba(23, 37, 63, 0.14), 0 1px 3px rgba(23, 37, 63, 0.08);
  --text: #2c3542;
  --text-strong: #121a26;
  --muted: #6f7b8b;
  --faint: #a3adba;
  --line: #e7ebf0;
  --hover: #f2f5f8;
  --selected: #eaf3fe;
  --accent: #1f7ae0;
  --accent-soft: #e6f0fc;
  --on-accent: #ffffff;
  --danger: #d93025;
  --danger-bg: #fdecea;
  --warn: #b26a00;
  --warn-bg: #fff3dc;
  --ok: #188038;
  --ok-bg: #e6f4ea;
  --attribution-bg: rgba(255, 255, 255, 0.75);
  color-scheme: light;
}
:root[data-theme="dark"] {
  --map-bg: #10151d;
  --panel: #1a212c;
  --panel-solid: #1a212c;
  --shadow: 0 6px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  --text: #d5dce6;
  --text-strong: #ffffff;
  --muted: #8b97a8;
  --faint: #5b6676;
  --line: #2a3340;
  --hover: #232b37;
  --selected: #1d3350;
  --accent: #4a9bff;
  --accent-soft: rgba(74, 155, 255, 0.16);
  --on-accent: #ffffff;
  --danger: #ff6b5e;
  --danger-bg: rgba(255, 107, 94, 0.16);
  --warn: #f5b947;
  --warn-bg: rgba(245, 185, 71, 0.16);
  --ok: #5fd08a;
  --ok-bg: rgba(95, 208, 138, 0.14);
  --attribution-bg: rgba(26, 33, 44, 0.8);
  color-scheme: dark;
}
html,
body,
#app {
  margin: 0;
  height: 100%;
  background: var(--map-bg);
  font: var(--font-size) var(--font);
}
#app {
  position: relative;
}
.error {
  position: absolute;
  z-index: 1000;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--danger-bg);
  color: var(--danger);
  font-weight: 600;
  box-shadow: var(--shadow);
}

/* Base maps: OSM tiles recoloured, so no tile key is needed */
.light-tiles {
  filter: grayscale(1) brightness(1.04) contrast(0.82);
}
.dark-tiles {
  filter: grayscale(1) invert(1) brightness(0.68) contrast(1.1);
}

/* Leaflet controls and popups in the app style */
.leaflet-container {
  background: var(--map-bg);
  font: var(--font-size) var(--font);
}
.leaflet-bar {
  border: 0 !important;
  border-radius: 999px !important;
  overflow: hidden;
  box-shadow: var(--shadow) !important;
}
.leaflet-control-zoom {
  margin-bottom: 86px !important; /* sits above the layers button */
  margin-right: 16px !important;
}
.leaflet-bar a {
  width: 40px !important;
  height: 40px !important;
  line-height: 40px !important;
  font-size: 20px !important;
  background: var(--panel) !important;
  color: var(--muted) !important;
  border-color: var(--line) !important;
}
.leaflet-bar a:hover {
  color: var(--accent) !important;
}
.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
  background: var(--panel) !important;
  color: var(--text) !important;
}
.leaflet-popup-content-wrapper {
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.leaflet-container a.leaflet-popup-close-button {
  top: 6px;
  right: 6px;
  color: var(--muted);
}
.leaflet-control-attribution {
  background: var(--attribution-bg) !important;
  color: var(--muted);
  border-radius: 8px 0 0 0;
}
.leaflet-control-attribution a {
  color: var(--muted);
}
</style>
