<script setup lang="ts">
import { computed, ref } from "vue";
import type { Detection } from "../types";
import { colorFor } from "../colors";

const props = defineProps<{ drones: Detection[]; selected: string | null }>();
const emit = defineEmits<{ select: [id: string] }>();

const open = ref(true);

const sorted = computed(() =>
  [...props.drones].sort((a, b) => a.basic_id.localeCompare(b.basic_id)),
);

function ago(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}
</script>

<template>
  <section class="panel">
    <button class="header" :aria-expanded="open" @click="open = !open">
      <span>Drones ({{ drones.length }})</span>
      <span class="chevron" :class="{ open }">▾</span>
    </button>

    <ul v-if="open" class="list">
      <li v-if="!sorted.length" class="empty">No drones detected</li>
      <li v-for="d in sorted" :key="d.basic_id">
        <button
          class="row"
          :class="{ selected: d.basic_id === selected }"
          @click="emit('select', d.basic_id)"
        >
          <span class="swatch" :style="{ background: colorFor(d.basic_id) }" />
          <span class="main">
            <span class="id">{{ d.basic_id }}</span>
            <span class="meta">
              {{ (d.drone_speed * 3.6).toFixed(0) }} km/h ·
              {{ d.drone_altitude }} m · {{ d.rssi }} dBm
            </span>
          </span>
          <span class="age">{{ ago(d.last_update) }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  width: 300px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 20px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.3);
  font:
    13px/1.3 system-ui,
    sans-serif;
  color: #1f2937;
  overflow: hidden;
}
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-weight: 600;
}
.chevron {
  transition: transform 0.15s;
  transform: rotate(-90deg);
}
.chevron.open {
  transform: rotate(0deg);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border-top: 1px solid #e5e7eb;
}
.empty {
  padding: 10px 12px;
  color: #6b7280;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
}
.row:hover {
  background: #f3f4f6;
}
.row.selected {
  background: #e0e7ff;
}
.swatch {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.id {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  color: #6b7280;
  font-size: 12px;
}
.age {
  flex: none;
  color: #6b7280;
  font-size: 12px;
}
</style>
