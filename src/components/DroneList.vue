<script setup lang="ts">
import { computed, ref } from "vue";
import type { Detection } from "../types";
import { exportAlerts, type ExportFormat } from "../export";
import type { Alert } from "../composables/useToasts";
import FlightStats from "./FlightStats.vue";
import type { ZoneCheck } from "../zones";
import { colorFor } from "../colors";
import { locale, t } from "../i18n";
import { FADE_SECONDS } from "../config";
import {
  fmtClock,
  REPLAY_PREFIX,
  type TrackStats,
} from "../composables/useReplay";

const props = defineProps<{
  drones: Detection[];
  selected: string | null;
  following: string | null;
  checks?: Record<string, ZoneCheck>;
  statsFor: (id: string) => TrackStats | null; // shown when a drone row is expanded
  alerts: Alert[]; // newest first
}>();
const emit = defineEmits<{
  select: [id: string];
  follow: [id: string | null];
  export: [id: string, format: ExportFormat];
  clearAlerts: [];
}>();

const open = ref(true);
const exportMenu = ref<string | null>(null);
const formats: ExportFormat[] = ["gpx", "kml", "csv"];

const alertsOpen = ref(false);
// Alerts of drones no longer on the map can't be focused
const present = computed(() => new Set(props.drones.map((d) => d.basic_id)));

const expanded = ref<string | null>(null); // drone whose stats are shown
// Recomputed on every poll (new drones array), so live values follow the flight
const expandedStats = computed(() =>
  props.drones && expanded.value ? props.statsFor(expanded.value) : null,
);

function onRow(id: string) {
  emit("select", id);
  expanded.value = expanded.value === id ? null : id;
}

const sorted = computed(() =>
  [...props.drones].sort((a, b) => a.basic_id.localeCompare(b.basic_id)),
);

const age = (ts: number) => Math.max(0, Math.floor(Date.now() / 1000 - ts));

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
      <span>{{ t("list.drones", { n: drones.length }) }}</span>
    </button>

    <ul v-if="open" class="list">
      <li v-if="!sorted.length" class="empty">{{ t("list.empty") }}</li>
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
          <button
            class="row"
            :aria-expanded="expanded === d.basic_id"
            @click="onRow(d.basic_id)"
          >
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
            :title="t(following === d.basic_id ? 'list.unfollow' : 'list.follow')"
            @click="toggleFollow(d.basic_id)"
          >
            ◎
          </button>
          <button
            v-if="!d.basic_id.startsWith(REPLAY_PREFIX)"
            class="action"
            :class="{ active: exportMenu === d.basic_id }"
            :title="t('list.export')"
            @click="exportMenu = exportMenu === d.basic_id ? null : d.basic_id"
          >
            ⤓
          </button>
        </div>
        <div v-if="exportMenu === d.basic_id" class="export">
          {{ t("list.exportTo") }}
          <button
            v-for="f in formats"
            :key="f"
            class="fmt"
            @click="doExport(d.basic_id, f)"
          >
            {{ f.toUpperCase() }}
          </button>
        </div>
        <div
          v-if="expandedStats && expanded === d.basic_id"
          class="stat"
          :style="{ borderLeftColor: colorFor(d.basic_id) }"
        >
          <FlightStats
            :s="expandedStats"
            :live="!d.basic_id.startsWith(REPLAY_PREFIX)"
          />
        </div>
      </li>
    </ul>

    <button
      class="header section"
      :aria-expanded="alertsOpen"
      @click="alertsOpen = !alertsOpen"
    >
      <span>{{ t("alerts.title", { n: alerts.length }) }}</span>
    </button>
    <div v-if="alertsOpen" class="alerts">
      <div v-if="alerts.length" class="tools">
        <button class="fmt" @click="exportAlerts(alerts)">
          {{ t("alerts.export") }}
        </button>
        <button class="fmt" @click="emit('clearAlerts')">
          {{ t("alerts.clear") }}
        </button>
      </div>
      <p v-else class="empty">{{ t("alerts.empty") }}</p>
      <button
        v-for="a in alerts"
        :key="a.key"
        class="alert-row"
        :class="a.kind"
        :disabled="!present.has(a.droneId)"
        :title="
          present.has(a.droneId)
            ? new Date(a.time).toLocaleString(locale())
            : t('alerts.gone')
        "
        @click="emit('select', a.droneId)"
      >
        <span class="swatch" :style="{ background: colorFor(a.droneId) }" />
        <span class="main">
          <span class="text">{{ t(a.msg, a.params) }}</span>
          <span class="id">{{ a.droneId }}</span>
        </span>
        <span class="age">{{ fmtClock(a.time) }}</span>
      </button>
    </div>

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
.header:hover {
  background: #f3f4f6;
}
/* Chevron: flattens and flips when the section opens */
.header::after {
  content: "";
  width: 1.25em;
  height: 1.25em;
  background: currentColor;
  mask: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M2 3.5 5 6.5 8 3.5' fill='none' stroke='black' stroke-width='1.5'/></svg>")
    center / contain no-repeat;
  transition: transform 0.15s;
  transform: scaleY(-1);
}
.header[aria-expanded="true"]::after {
  transform: scaleY(1);
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
.stat {
  padding: 8px 12px 8px 9px;
  background: #fff; /* also under a highlighted row */
  border-left: 3px solid; /* drone color, tells blocks apart in multi-drone files */
}
.section {
  border-top: 1px solid #e5e7eb;
}
.alerts {
  overflow-y: auto;
  border-top: 1px solid #e5e7eb;
}
.tools {
  display: flex;
  gap: 6px;
  padding: 6px 12px;
}
.alert-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
}
.alert-row:hover:not(:disabled) {
  background: #f3f4f6;
}
.alert-row:disabled {
  cursor: default;
  opacity: 0.5;
}
.alert-row.alert .text {
  color: #b91c1c;
  font-weight: 600;
}
.fmt:hover {
  background: #f3f4f6;
}
</style>
