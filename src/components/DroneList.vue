<script setup lang="ts">
import { computed, ref } from "vue";
import type { Detection } from "../types";
import type { ExportFormat } from "../export";
import type { ZoneCheck } from "../zones";
import { colorFor } from "../colors";
import { FADE_SECONDS } from "../config";

const props = defineProps<{
  drones: Detection[];
  selected: string | null;
  following: string | null;
  checks?: Record<string, ZoneCheck>;
}>();
const emit = defineEmits<{
  select: [id: string];
  follow: [id: string | null];
  export: [id: string, format: ExportFormat];
}>();

const open = ref(true);
const exportMenu = ref<string | null>(null);
const formats: ExportFormat[] = ["gpx", "kml", "csv"];

const sorted = computed(() =>
  [...props.drones].sort((a, b) => a.basic_id.localeCompare(b.basic_id)),
);

const age = (ts: number) => Math.max(0, Math.round(Date.now() / 1000 - ts));

function ago(ts: number): string {
  const s = age(ts);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

function toggleFollow(id: string) {
  emit("follow", props.following === id ? null : id);
}

function doExport(id: string, f: ExportFormat) {
  emit("export", id, f);
  exportMenu.value = null;
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
      <li
        v-for="d in sorted"
        :key="d.basic_id"
        class="item"
        :class="{
          selected: d.basic_id === selected,
          stale: age(d.last_update) > FADE_SECONDS,
        }"
      >
        <div class="line">
          <button class="row" @click="emit('select', d.basic_id)">
            <span
              class="swatch"
              :style="{ background: colorFor(d.basic_id) }"
            />
            <span class="main">
              <span class="id">{{ d.basic_id }}</span>
              <span
                v-if="checks?.[d.basic_id] && checks[d.basic_id].level !== 'ok'"
                class="badge"
                :class="checks[d.basic_id].level"
              >
                {{ checks[d.basic_id].label }}
              </span>
              <span class="meta">
                {{ (d.drone_speed * 3.6).toFixed(0) }} km/h ·
                {{ d.drone_altitude }} m · {{ d.rssi }} dBm
              </span>
            </span>
            <span class="age">{{ ago(d.last_update) }}</span>
          </button>
          <button
            class="action"
            :class="{ active: following === d.basic_id }"
            :title="following === d.basic_id ? 'Stop following' : 'Follow'"
            @click="toggleFollow(d.basic_id)"
          >
            ◎
          </button>
          <button
            class="action"
            :class="{ active: exportMenu === d.basic_id }"
            title="Export track"
            @click="exportMenu = exportMenu === d.basic_id ? null : d.basic_id"
          >
            ⤓
          </button>
        </div>
        <div v-if="exportMenu === d.basic_id" class="export">
          Export track:
          <button
            v-for="f in formats"
            :key="f"
            class="fmt"
            @click="doExport(d.basic_id, f)"
          >
            {{ f.toUpperCase() }}
          </button>
        </div>
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
  width: 320px;
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
.item:hover {
  background: #f3f4f6;
}
.item.selected {
  background: #e0e7ff;
}
.item.stale {
  opacity: 0.5;
}
.line {
  display: flex;
  align-items: center;
  padding-right: 6px;
}
.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px 8px 12px;
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
.badge {
  align-self: flex-start;
  margin: 2px 0;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.badge.alert {
  background: #fee2e2;
  color: #b91c1c;
}
.badge.warn {
  background: #fef3c7;
  color: #92400e;
}
.badge.info {
  background: #e5e7eb;
  color: #374151;
}
.age {
  flex: none;
  color: #6b7280;
  font-size: 12px;
}
.action {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  text-align: center;
  font-size: 15px;
  color: #6b7280;
}
.action:hover {
  background: #e5e7eb;
  color: #111827;
}
.action.active {
  background: #4363d8;
  color: #fff;
}
.export {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 8px 34px;
  font-size: 12px;
  color: #6b7280;
}
.fmt {
  padding: 2px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 11px;
  color: #1f2937;
  background: #fff;
}
.fmt:hover {
  background: #f3f4f6;
}
</style>
