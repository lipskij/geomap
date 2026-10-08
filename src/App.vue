<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import MapView from "./components/MapView.vue";
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
    @unfollow="following = null"
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
  /* Neutral greys; colour only carries meaning (alert, warning, OK) */
  --panel: #131416;
  --panel-solid: #131416;
  --shadow: 0 0 0 1px #2c2e33;
  --text: #d6d7da;
  --text-strong: #ffffff;
  --muted: #8b8e94;
  --faint: #5d6066;
  --line: #24262a;
  --hover: #1c1e21;
  --selected: #24262a;
  --accent: #ffffff;
  --on-accent: #131416;
  --danger: #ff5a52;
  --danger-bg: rgba(255, 90, 82, 0.14);
  --warn: #fbbf24;
  --warn-bg: rgba(251, 191, 36, 0.16);
  --ok: #5fd08a;
  --icon-arm: #e5e7eb;
  --attribution-bg: rgba(19, 20, 22, 0.8);
  color-scheme: dark;
}
/* Light map / satellite: the original light panels */
:root[data-theme="light"] {
  --panel: #fff;
  --panel-solid: #fff;
  --shadow: 0 1px 5px rgba(0, 0, 0, 0.3);
  --text: #1f2937;
  --text-strong: #111827;
  --muted: #6b7280;
  --faint: #9ca3af;
  --line: #e5e7eb;
  --hover: #f3f4f6;
  --selected: #e0e7ff;
  --accent: #4363d8;
  --on-accent: #fff;
  --danger: #b91c1c;
  --danger-bg: #fee2e2;
  --warn: #92400e;
  --warn-bg: #fef3c7;
  --ok: #166534;
  --icon-arm: #1f2937;
  --attribution-bg: rgba(255, 255, 255, 0.8);
  color-scheme: light;
}
html,
body,
#app {
  margin: 0;
  height: 100%;
  background: #0e0f11;
}
#app {
  position: relative;
}
.error {
  position: absolute;
  z-index: 1000;
  margin: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--danger-bg);
  color: var(--danger);
}

.dark-tiles {
  filter: grayscale(1) invert(1) brightness(0.62) contrast(1.15);
}

/* Leaflet controls and popups in the same dark style */
.leaflet-container {
  background: #0e0f11;
  font: 13px/1.3 system-ui, sans-serif;
}
.leaflet-bar,
.leaflet-control-layers {
  border: 0 !important;
  border-radius: 2px !important;
  overflow: hidden;
  box-shadow: var(--shadow) !important;
}
.leaflet-bar a,
.leaflet-control-layers,
.leaflet-popup-content-wrapper,
.leaflet-popup-tip {
  background: var(--panel-solid) !important;
  color: var(--text) !important;
  border-color: var(--line) !important;
}
.leaflet-bar a:hover {
  background: var(--hover) !important;
}
.leaflet-control-layers-separator {
  border-top-color: var(--line) !important;
}
.leaflet-popup-content-wrapper {
  border-radius: 2px;
  box-shadow: var(--shadow);
}
.leaflet-container a.leaflet-popup-close-button {
  color: var(--muted);
}
.leaflet-control-attribution {
  background: var(--attribution-bg) !important;
  color: var(--faint);
}
.leaflet-control-attribution a {
  color: var(--muted);
}
</style>
