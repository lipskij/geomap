<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import MapView from "./components/MapView.vue";
import DroneList from "./components/DroneList.vue";
import ToastStack from "./components/ToastStack.vue";
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
import {
  FADE_SECONDS,
  MAX_ALT_M,
  POLL_MS,
  STALE_SECONDS,
  ZONES_ENABLED,
} from "./config";

const { detections, error } = useDetections(POLL_MS);
const { getTrack } = useTrackHistory(detections);

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

// Zones active right now (temporary zones / schedules). Re-checked every poll, but the
// array is only replaced when the set changes, so the map doesn't redraw zones every second.
const activeZones = shallowRef<Zone[]>([]);
let lastZones: Zone[] | null = null;
watch([zones, detections], () => {
  const next = zones.value.filter((z) => isZoneActive(z));
  const ids = (list: Zone[]) => list.map((z) => z.id).join("|");
  if (zones.value !== lastZones || ids(next) !== ids(activeZones.value))
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
  <MapView
    ref="mapView"
    :detections="detections"
    :zones="activeZones"
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
