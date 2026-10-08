<script setup lang="ts">
import { ref } from "vue";
import { fmtDuration as fmt } from "../composables/useReplay";
import { plural, t } from "../i18n";
import Icon from "./Icon.vue";

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
      <Icon name="upload" />
      {{ t("replay.import") }}
    </button>

    <template v-else>
      <div class="head">
        <span class="name" :title="fileName">{{ fileName }}</span>
        <span class="count">{{ plural("replay.drones", droneCount) }}</span>
        <button class="icon" :title="t('replay.loadAnother')" @click="input?.click()">
          <Icon name="upload" />
        </button>
        <button class="icon" :title="t('replay.close')" @click="emit('close')">
          <Icon name="close" />
        </button>
      </div>
      <div class="controls">
        <button class="skip" :title="t('replay.back')" @click="emit('seek', position - 5000)">
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
        <button class="skip" :title="t('replay.forward')" @click="emit('seek', position + 5000)">
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
      <div class="time">
        <Icon name="clock" />{{ fmt(position) }} / {{ fmt(duration) }}
      </div>
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
  padding: 6px;
  background: var(--panel);
  border-radius: 999px;
  box-shadow: var(--shadow);
  font: var(--font-size) var(--font);
  color: var(--text);
  box-sizing: border-box;
}
.replay.loaded {
  width: 460px;
  padding: 12px 16px 14px;
  border-radius: var(--radius-lg);
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
  gap: 8px;
  padding: 6px 14px 6px 10px;
  border-radius: 999px;
  font-weight: 600;
  color: var(--accent);
}
.open .icon {
  font-size: 18px;
}
.open:hover {
  background: var(--accent-soft);
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name {
  flex: 1;
  min-width: 0;
  font: 700 15px var(--font-head);
  letter-spacing: 0.02em;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
button.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 16px;
  color: var(--muted);
}
button.icon:hover {
  background: var(--hover);
  color: var(--text-strong);
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.play,
.skip {
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 50%;
}
.play {
  width: 42px;
  height: 42px;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 3px 10px color-mix(in srgb, var(--accent) 40%, transparent);
}
.play svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}
.skip {
  width: 32px;
  height: 32px;
  background: var(--hover);
  color: var(--muted);
}
.skip:hover {
  color: var(--accent);
}
.skip svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}
.seek {
  flex: 1;
  min-width: 0;
  margin-left: 6px;
  accent-color: var(--accent);
}
.speed {
  flex: none;
  padding: 3px 6px;
  border: 0;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}
.time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--hover);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.time .icon {
  font-size: 14px;
  color: var(--muted);
}
.err {
  margin-top: 6px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--danger);
}
</style>
