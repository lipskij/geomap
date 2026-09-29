<script setup lang="ts">
import { computed, ref } from "vue";
import MapView from "./components/MapView.vue";
import DroneList from "./components/DroneList.vue";
import { useDetections } from "./composables/useDetections";

const STALE_SECONDS = 60;

const { detections, error } = useDetections(1000);
const mapView = ref<InstanceType<typeof MapView>>();
const selected = ref<string | null>(null);

const activeDrones = computed(() => {
  const now = Date.now() / 1000;
  return Object.values(detections.value).filter(
    (d) => d.last_update && now - d.last_update <= STALE_SECONDS,
  );
});

function focusDrone(id: string) {
  selected.value = id;
  mapView.value?.focus(id);
}
</script>

<template>
  <p v-if="error" class="error">Failed to load detections: {{ error }}</p>
  <MapView
    ref="mapView"
    :detections="detections"
    :stale-seconds="STALE_SECONDS"
  />
  <DroneList :drones="activeDrones" :selected="selected" @select="focusDrone" />
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
