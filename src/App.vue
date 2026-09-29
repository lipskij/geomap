<script setup lang="ts">
import MapView from './components/MapView.vue'
import { useDetections } from './composables/useDetections'

const { detections, error } = useDetections(1000)
</script>

<template>
  <p v-if="error" class="error">Failed to load detections: {{ error }}</p>
  <MapView :detections="detections" />
</template>

<style>
html, body, #app { margin: 0; height: 100%; }
.error { position: absolute; z-index: 1000; margin: 8px; padding: 6px 10px; background: #fee; color: #900; }
</style>
