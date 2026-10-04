<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MapView from "./components/MapView.vue";
import DroneList from "./components/DroneList.vue";
import ToastStack from "./components/ToastStack.vue";
import ReplayPanel from "./components/ReplayPanel.vue";
import { useReplay } from "./composables/useReplay";
import { useDetections } from "./composables/useDetections";
import { useTrackHistory } from "./composables/useTrackHistory";
import { useToasts } from "./composables/useToasts";
import { useZones } from "./composables/useZones";
import { usePlans } from "./composables/usePlans";
import { useActiveSubset } from "./composables/useActiveSubset";
import { activeVolumes, isPlanActive } from "./plans";
import { inPolygon } from "./geo";
import { USE_MOCK } from "./api";
import { setDemoArea } from "./mock/detections";
import { checkPosition, isZoneActive, type ZoneCheck } from "./zones";
import { exportTrack, type ExportFormat } from "./export";
import {
  FADE_SECONDS,
  MAX_ALT_M,
  POLL_MS,
  STALE_SECONDS,
  ZONES_ENABLED,
} from "./config";

const { detections: live, error } = useDetections(POLL_MS);
const replay = useReplay();

// While a replay is loaded, show only the replayed drones; otherwise live (or mock) ones
const detections = computed(() =>
  replay.fileName.value ? replay.detections.value : live.value,
);
// History keeps recording live drones even while a replay is shown
const { getTrack } = useTrackHistory(live);

// Replayed paths follow the recorded points up to the current time (also after seeking
// and at high speed), instead of joining sampled positions with straight lines
watch(replay.detections, () => {
  for (const [id, pts] of Object.entries(replay.pathsAtPosition()))
    mapView.value?.setPath(id, pts);
});

const mapView = ref<InstanceType<typeof MapView>>();
const selected = ref<string | null>(null);
const following = ref<string | null>(null);

const activeDrones = computed(() => {
  const now = Date.now() / 1000;
  return Object.values(detections.value).filter(
    (d) => d.last_update && now - d.last_update <= STALE_SECONDS,
  );
});

const { toasts, dismiss, push } = useToasts(activeDrones);
const { zones, error: zonesError } = useZones();
const { plans, error: plansError, loaded: plansLoaded } = usePlans();

// Zones / flight plans active right now. Re-checked every poll, but only replaced when the
// set changes, so the map doesn't redraw these layers every second.
const activeZones = useActiveSubset(
  zones,
  detections,
  (z) => isZoneActive(z),
  (z) => z.id,
);
const activePlans = useActiveSubset(
  plans,
  detections,
  (p) => isPlanActive(p),
  (p) => `${p.id}:${p.state}:${activeVolumes(p).length}`,
);

// Per-drone zone / altitude / flight plan status (only when zone data is available)
const checks = computed<Record<string, ZoneCheck>>(() => {
  if (!ZONES_ENABLED || !activeZones.value.length) return {};
  const planData = plansLoaded.value ? activePlans.value : null;
  const out: Record<string, ZoneCheck> = {};
  for (const d of activeDrones.value) {
    out[d.basic_id] = checkPosition(
      d.drone_lat,
      d.drone_long,
      d.drone_altitude,
      activeZones.value,
      MAX_ALT_M,
      planData,
    );
  }
  return out;
});

// Alert when a drone without an approved plan enters a prohibited zone or goes above the altitude limit
const lastAlert = new Map<string, string>();
watch(checks, (all) => {
  for (const [id, c] of Object.entries(all)) {
    const prohibited = c.zones.find((z) => z.restriction === "PROHIBITED");
    const key = c.plan
      ? ""
      : prohibited
        ? `p:${prohibited.id}`
        : c.aboveMax
          ? "above"
          : "";
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

// Mock mode only: fly a demo drone inside the first active approved plan, so the
// "Approved plan" status can be shown without real receivers.
if (USE_MOCK && ZONES_ENABLED) {
  watch(activePlans, (list) => {
    for (const plan of list) {
      if (!plan.approved) continue;
      const v = activeVolumes(plan)[0];
      const [minLng, minLat, maxLng, maxLat] = v.bbox;
      const lat = (minLat + maxLat) / 2;
      const lng = (minLng + maxLng) / 2;
      if (!inPolygon(lng, lat, v.rings, v.bbox)) continue;
      const radius =
        Math.min((maxLat - minLat) / 2, (maxLng - minLng) / 2 / 1.7) * 0.4;
      const alt = Math.round(Math.max(v.minM + 5, Math.min(v.maxM - 10, 60)));
      setDemoArea({ lat, lng, radius, alt });
      return;
    }
    setDemoArea(null);
  });
}

// Stop following a drone that has disappeared
watch(activeDrones, (list) => {
  if (following.value && !list.some((d) => d.basic_id === following.value))
    following.value = null;
});

function focusDrone(id: string) {
  // Focusing another drone cancels follow, otherwise the map jumps between the two
  if (following.value && following.value !== id) following.value = null;
  selected.value = id;
  mapView.value?.focus(id);
}

function setFollow(id: string | null) {
  following.value = id;
  if (id) focusDrone(id);
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
  <p v-else-if="plansError" class="error">
    Failed to load flight plans: {{ plansError }}
  </p>
  <MapView
    ref="mapView"
    :detections="detections"
    :zones="activeZones"
    :plans="activePlans"
    :checks="checks"
    :following="following"
    :fade-seconds="FADE_SECONDS"
    :stale-seconds="STALE_SECONDS"
    @unfollow="following = null"
  />
  <DroneList
    :drones="activeDrones"
    :selected="selected"
    :following="following"
    :checks="checks"
    @select="focusDrone"
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
