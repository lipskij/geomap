<script setup lang="ts">
import { ref } from "vue";
import { fmtDuration as fmt } from "../composables/useReplay";
import { plural, t } from "../i18n";

defineProps<{
  fileName: string;
  droneCount: number;
  playing: boolean;
  speed: number;
  position: number; // ms
  duration: number; // ms
  error: string | null;
}>();
const emit = defineEmits<{
  load: [file: File];
  toggle: [];
  seek: [ms: number];
  speed: [value: number];
  close: [];
}>();

const input = ref<HTMLInputElement>();
const speeds = [1, 2, 5, 10, 30];

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) emit("load", file);
  (e.target as HTMLInputElement).value = ""; // allow loading the same file again
}
</script>

<template>
  <section class="replay">
    <input
      ref="input"
      type="file"
      accept=".csv,.gpx,.kml"
      hidden
      @change="onFile"
    />

    <button v-if="!fileName" class="open" @click="input?.click()">
      {{ t("replay.open") }}
    </button>

    <template v-else>
      <div class="head">
        <span class="name" :title="fileName">{{ fileName }}</span>
        <span class="count">{{ plural("replay.drones", droneCount) }}</span>
        <button class="icon" :title="t('replay.loadAnother')" @click="input?.click()">
          ⤒
        </button>
        <button class="icon" :title="t('replay.close')" @click="emit('close')">
          ×
        </button>
      </div>
      <div class="controls">
        <button
          class="play"
          :title="t(playing ? 'replay.pause' : 'replay.play')"
          @click="emit('toggle')"
        >
          {{ playing ? "❚❚" : "⏵" }}
        </button>
        <input
          class="seek"
          type="range"
          min="0"
          :max="duration"
          step="100"
          :value="position"
          @input="
            emit('seek', Number(($event.target as HTMLInputElement).value))
          "
        />
        <select
          class="speed"
          :title="t('replay.speed')"
          :value="speed"
          @change="
            emit('speed', Number(($event.target as HTMLSelectElement).value))
          "
        >
          <option v-for="s in speeds" :key="s" :value="s">{{ s }}×</option>
        </select>
      </div>
      <div class="time">{{ fmt(position) }} / {{ fmt(duration) }}</div>
    </template>

    <div v-if="error" class="err">{{ error }}</div>
  </section>
</template>

<style scoped>
.replay {
  position: absolute;
  left: 10px;
  bottom: 24px;
  z-index: 1000;
  max-width: calc(100vw - 20px);
  padding: 8px 10px;
  background: var(--panel);
  border-radius: 2px;
  box-shadow: var(--shadow);
  font:
    13px/1.3 system-ui,
    sans-serif;
  color: var(--text);
  box-sizing: border-box;
}
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}
.open {
  width: 100%;
  text-align: left;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 4px;
}
.open:hover {
  background: var(--hover);
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  flex: none;
  color: var(--muted);
  font-size: 12px;
}
.icon {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1;
  color: var(--muted);
}
.icon:hover {
  background: var(--line);
  color: var(--text-strong);
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.play {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
}
.seek {
  flex: 1;
  min-width: 0;
}
.speed {
  flex: none;
  font: inherit;
  font-size: 12px;
  padding: 1px 2px;
}
.time {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.err {
  margin-top: 4px;
  font-size: 12px;
  color: var(--danger);
}
</style>
