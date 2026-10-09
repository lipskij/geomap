<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import MapView, { type BaseLayer } from "./components/MapView.vue";
import LayersPanel from "./components/LayersPanel.vue";
import PlannerPanel from "./components/PlannerPanel.vue";
import { useSensors, type SensorType } from "./composables/useSensors";
import DroneList from "./components/DroneList.vue";
import ToastStack from "./components/ToastStack.vue";
import ReplayPanel from "./components/ReplayPanel.vue";
import DetectionPanel from "./components/DetectionPanel.vue";
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
import { ACOUSTIC_ID, useAcoustic } from "./composables/useAcoustic";
import { MOCK_ACOUSTIC_SENSORS } from "./mock/acoustic";
import { USE_MOCK } from "./api";
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

// Monitor: live drones. Planner: place sensors on the map (the right panel switches)
const mode = ref<"monitor" | "planner" | "detection">("monitor");
const placing = ref<SensorType | null>(null); // planner tool picked for click-to-place
const overlap = ref<SensorType | "all" | null>("all"); // planner overlap shading, null = off
const liveInPlanner = ref(false); // planner switch: also show live drones and monitoring
const showDrones = computed(() => mode.value !== "planner" || liveInPlanner.value);
const plan = useSensors();
watch(mode, (m) => {
  placing.value = null;
  if (m === "detection") nextTick(() => mapView.value?.fitSensors()); // show the mesh
});
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
// Drone heard by 2+ acoustic sensors: warn once per target
// Acoustic sensors: the mock mesh while mocking, otherwise the planned audio sensors
const acousticSensors = computed(() =>
  USE_MOCK
    ? MOCK_ACOUSTIC_SENSORS
    : plan.sensors.value.filter((s) => s.type === "audio"),
);
const { track: acoustic, hearing } = useAcoustic(acousticSensors, (n) =>
  push(ACOUSTIC_ID, "msg.acoustic", { n }, "alert"),
);

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

// Hiding drones (planner mode) drops focus and follow: the map must not chase a hidden drone
watch(showDrones, (on) => {
  if (!on) following.value = selected.value = null;
});

// Stop following a drone that has disappeared
watch(activeDrones, (list) => {
  if (following.value && !list.some((d) => d.basic_id === following.value))
    following.value = null;
});

function focusDrone(id: string): boolean {
  // The acoustic target has no marker of its own: its details live in the detection panel
  if (id === ACOUSTIC_ID) {
    mode.value = "detection";
    return true;
  }
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
    :sensors="mode === 'detection' ? acousticSensors : plan.sensors.value"
    :planning="mode === 'planner'"
    :show-sensors="mode !== 'monitor'"
    :placing="placing"
    :overlap="overlap"
    :show-drones="showDrones"
    :acoustic="acoustic"
    :acoustic-sensors="acousticSensors"
    @unfollow="following = null"
    @add-sensor="plan.add"
    @move-sensor="plan.move"
  />
  <div class="mode" role="tablist">
    <button
      v-for="m in ['monitor', 'planner', 'detection'] as const"
      :key="m"
      role="tab"
      :aria-selected="mode === m"
      @click="mode = m"
    >
      {{ t(`mode.${m}`) }}
    </button>
  </div>
  <PlannerPanel
    v-if="mode === 'planner'"
    :name="plan.name.value"
    :sensors="plan.sensors.value"
    :placing="placing"
    :overlap="overlap"
    :save-error="plan.saveError.value"
    :show-live="liveInPlanner"
    @pick="(type) => (placing = type)"
    @select="(s) => mapView?.panTo(s.lat, s.lng)"
    @remove="plan.remove"
    @mast="plan.setMast"
    @clear="plan.clear"
    @rename="(n) => (plan.name.value = n)"
    @overlap="(v) => (overlap = v)"
    @show-live="(v) => (liveInPlanner = v)"
    @import="
      (p) => {
        plan.replace(p);
        nextTick(() => mapView?.fitSensors());
      }
    "
  />
  <DetectionPanel
    v-if="mode === 'detection'"
    :track="acoustic"
    :hearing="hearing"
    :sensors="acousticSensors"
    @select="(s) => mapView?.panTo(s.lat, s.lng)"
  />
  <LayersPanel
    v-model:base="base"
    v-model:show-zones="showZones"
    :zones-available="ZONES_ENABLED"
  />
  <DroneList
    v-if="mode === 'monitor'"
    :drones="activeDrones"
    :selected="selected"
    :following="following"
    :checks="checks"
    :stats-for="statsFor"
    :alerts="alerts"
    :acoustic="acoustic"
    @select="focusDrone"
    @clear-alerts="clearAlerts"
    @open-detection="mode = 'detection'"
    @follow="setFollow"
    @export="onExport"
  />
  <ToastStack
    v-if="showDrones"
    :toasts="toasts"
    @select="focusDrone"
    @dismiss="dismiss"
  />
  <ReplayPanel
    v-show="showDrones"
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

/* Plain buttons; components style them with classes */
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
  text-align: left;
}

/* Right-hand panel (drone list / sensor planner) and its section headings */
.side-panel {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  width: 320px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 220px); /* keeps the zoom and layers buttons below it visible */
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  font: var(--font-size) var(--font);
  color: var(--text);
  overflow: hidden;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font: 700 15px var(--font-head);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-strong);
}
.panel-title .icon {
  font-size: 18px;
  color: var(--accent);
}

/* Monitor / Planner switch, top-left; notifications stack below it */
.mode {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000;
  display: flex;
  padding: 4px;
  border-radius: 999px;
  background: var(--panel);
  box-shadow: var(--shadow);
}
.mode button {
  padding: 7px 16px;
  border: 0;
  border-radius: 999px;
  background: none;
  font: 600 14px var(--font);
  color: var(--muted);
  cursor: pointer;
}
.mode button[aria-selected="true"] {
  background: var(--accent);
  color: var(--on-accent);
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
