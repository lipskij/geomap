<script setup lang="ts">
import { computed, ref } from "vue";
import type { Detection } from "../types";
import { exportAlerts, type ExportFormat } from "../export";
import type { Alert } from "../composables/useToasts";
import FlightStats from "./FlightStats.vue";
import Icon from "./Icon.vue";
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
  <section class="side-panel">
    <button class="header" :aria-expanded="open" @click="open = !open">
      <span class="panel-title">
        <Icon name="drone" />{{ t("list.drones", { n: drones.length }) }}
      </span>
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
            <span class="disc" :style="{ background: colorFor(d.basic_id) }">
              <Icon name="drone" />
            </span>
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
            <Icon name="follow" />
          </button>
          <button
            v-if="!d.basic_id.startsWith(REPLAY_PREFIX)"
            class="action"
            :class="{ active: exportMenu === d.basic_id }"
            :title="t('list.export')"
            @click="exportMenu = exportMenu === d.basic_id ? null : d.basic_id"
          >
            <Icon name="download" />
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
        <div v-if="expandedStats && expanded === d.basic_id" class="stat">
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
      <span class="panel-title">
        <Icon name="bell" />{{ t("alerts.title", { n: alerts.length }) }}
      </span>
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
        <span class="dot" :style="{ background: colorFor(a.droneId) }" />
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
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}
.header:hover {
  background: var(--hover);
}
/* Chevron: flattens and flips when the section opens */
.header::after {
  content: "";
  width: 1.25em;
  height: 1.25em;
  background: var(--muted);
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
  padding: 0 0 6px;
  overflow-y: auto;
}
.empty {
  margin: 0;
  padding: 4px 16px 12px;
  color: var(--muted);
}
.item {
  margin: 0 8px;
  border-radius: var(--radius);
}
.item:hover {
  background: var(--hover);
}
.item.selected {
  background: var(--selected);
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
  gap: 12px;
  padding: 9px 6px 9px 10px;
}
.disc {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #fff;
  font-size: 19px;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  color: var(--muted);
  font-size: 13px;
}
.badge {
  align-self: flex-start;
  margin: 2px 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.badge.alert {
  background: var(--danger-bg);
  color: var(--danger);
}
.badge.warn {
  background: var(--warn-bg);
  color: var(--warn);
}
.badge.info {
  background: var(--hover);
  color: var(--muted);
}
.age {
  flex: none;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.action {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 17px;
  color: var(--muted);
}
.action:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.action.active {
  background: var(--accent);
  color: var(--on-accent);
}
.export {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 10px 54px;
  font-size: 12px;
  color: var(--muted);
}
.fmt {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: var(--hover);
}
.fmt:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.stat {
  margin: 0 0 8px;
  padding: 4px 10px 10px;
}
.section {
  border-top: 1px solid var(--line);
}
.alerts {
  overflow-y: auto;
  padding-bottom: 6px;
}
.tools {
  display: flex;
  gap: 6px;
  padding: 0 16px 8px;
}
.alert-row {
  width: calc(100% - 16px);
  margin: 0 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-radius: var(--radius);
}
.alert-row:hover:not(:disabled) {
  background: var(--hover);
}
.alert-row:disabled {
  cursor: default;
  opacity: 0.5;
}
.alert-row.alert .text {
  color: var(--danger);
  font-weight: 600;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
</style>
