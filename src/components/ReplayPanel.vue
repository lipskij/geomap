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
  <section class="replay" :class="{ loaded: fileName }">
    <input
      ref="input"
      type="file"
      accept=".csv,.gpx,.kml"
      hidden
      @change="onFile"
    />

    <button
      v-if="!fileName"
      class="open"
      :title="t('replay.open')"
      @click="input?.click()"
    >
      <svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zm7-16-6 6h4v6h4v-6h4z" /></svg>
      {{ t("replay.import") }}
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
        <button class="play small" :title="t('replay.back')" @click="emit('seek', position - 5000)">
          <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15.6" text-anchor="middle" font-size="6.5" font-weight="700" fill="currentColor">5</text></svg>
        </button>
        <button
          class="play"
          :title="t(playing ? 'replay.pause' : 'replay.play')"
          @click="emit('toggle')"
        >
          <svg viewBox="0 0 24 24">
            <path v-if="playing" d="M6 5h4v14H6zm8 0h4v14h-4z" />
            <path v-else d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button class="play small" :title="t('replay.forward')" @click="emit('seek', position + 5000)">
          <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" transform="matrix(-1 0 0 1 24 0)"/><text x="12" y="15.6" text-anchor="middle" font-size="6.5" font-weight="700" fill="currentColor">5</text></svg>
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
/* Top, left of the drone panel (320 px wide + 10 px margin, plus a 10 px gap) */
.replay {
  position: absolute;
  top: 10px;
  right: 340px;
  z-index: 1000;
  max-width: calc(100vw - 360px);
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
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 4px;
}
.open svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
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
  color: var(--text);
  font-size: 12px;
}
.icon {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1;
  color: var(--text);
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
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  padding: 0;
  background: var(--accent);
  color: var(--on-accent);
}
.replay.loaded {
  width: 440px;
  padding: 12px 14px;
}
.replay.loaded .controls {
  gap: 10px;
  margin-top: 10px;
}
.replay.loaded .time {
  margin-top: 6px;
}
/* Narrow screens: no room beside the drone panel, back to the bottom-left */
@media (max-width: 760px) {
  .replay {
    top: auto;
    right: auto;
    left: 10px;
    bottom: 24px;
    max-width: calc(100vw - 20px);
  }
}
.play.small {
  width: 26px;
  height: 26px;
}
.play.small svg {
  width: 15px;
  height: 15px;
}
.play svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
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
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.err {
  margin-top: 4px;
  font-size: 12px;
  color: var(--danger);
}
</style>
