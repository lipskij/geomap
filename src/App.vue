<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MapView from "./components/MapView.vue";
import DroneList from "./components/DroneList.vue";
import ToastStack from "./components/ToastStack.vue";
import { useDetections } from "./composables/useDetections";
import { useTrackHistory } from "./composables/useTrackHistory";
import { useNewDroneToasts } from "./composables/useToasts";
import { exportTrack, type ExportFormat } from "./export";
import { FADE_SECONDS, POLL_MS, STALE_SECONDS } from "./config";

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

const { toasts, dismiss } = useNewDroneToasts(activeDrones);

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
  <MapView
    ref="mapView"
    :detections="detections"
    :following="following"
    :fade-seconds="FADE_SECONDS"
    :stale-seconds="STALE_SECONDS"
    @unfollow="following = null"
  />
  <DroneList
    :drones="activeDrones"
    :selected="selected"
    :following="following"
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
