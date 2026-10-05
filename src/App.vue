<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import MapView from "./components/MapView.vue";
import DroneList from "./components/DroneList.vue";
import ToastStack from "./components/ToastStack.vue";
import ReplayPanel from "./components/ReplayPanel.vue";
import { REPLAY_PREFIX, trackStats, useReplay } from "./composables/useReplay";
import { useDetections } from "./composables/useDetections";
import { useTrackHistory } from "./composables/useTrackHistory";
import { useToasts } from "./composables/useToasts";
import { useZones } from "./composables/useZones";
import { checkPosition, isZoneActive, type Zone, type ZoneCheck } from "./zones";
import { exportTrack, type ExportFormat } from "./export";
import { MAX_ALT_M, POLL_MS, STALE_SECONDS, ZONES_ENABLED } from "./config";

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
      push(
        id,
        prohibited
          ? `Entered prohibited zone ${prohibited.name}`
          : `Above ${MAX_ALT_M} m`,
        "alert",
      );
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

// Replayed drone: whole-file stats. Live drone: from its recorded history (seconds → ms).
// ponytail: live is a full recompute per poll for the opened drone; go incremental if long flights lag
function statsFor(id: string) {
  if (replay.fileName.value)
    return replayStats.value.find((s) => s.id === id) ?? null;
  const pts = getTrack(id).map((p) => ({ ...p, t: p.t * 1000 }));
  return pts.length ? trackStats(id, pts, zones.value) : null;
}

function onExport(id: string, format: ExportFormat) {
  exportTrack(id, getTrack(id), format);
}
</script>

<template>
  <p v-if="error" class="error">Failed to load detections: {{ error }}</p>
  <p v-else-if="zonesError" class="error">
    Failed to load drone zones: {{ zonesError }}
  </p>
  <MapView
    ref="mapView"
    :detections="detections"
    :zones="activeZones"
    :checks="checks"
    :following="following"
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
html,
body,
#app {
  margin: 0;
  height: 100%;
}
#app {
  position: relative;
}
.error {
  position: absolute;
  z-index: 1000;
  margin: 8px;
  padding: 6px 10px;
  background: #fee;
  color: #900;
}
</style>
