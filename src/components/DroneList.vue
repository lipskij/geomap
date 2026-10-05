<script setup lang="ts">
import { computed, ref } from "vue";
import type { Detection } from "../types";
import { copyText, type ExportFormat } from "../export";
import type { ZoneCheck } from "../zones";
import { colorFor } from "../colors";
import { FADE_SECONDS, MAX_ALT_M } from "../config";
import {
  fmtDuration,
  REPLAY_PREFIX,
  type TrackStats,
} from "../composables/useReplay";

const props = defineProps<{
  drones: Detection[];
  selected: string | null;
  following: string | null;
  checks?: Record<string, ZoneCheck>;
  stats?: TrackStats[]; // replay only
}>();
const emit = defineEmits<{
  select: [id: string];
  follow: [id: string | null];
  export: [id: string, format: ExportFormat];
}>();

const open = ref(true);
const exportMenu = ref<string | null>(null);
const formats: ExportFormat[] = ["gpx", "kml", "csv"];

const statsOpen = ref(true);
const copied = ref<string | null>(null);
// Local clock time; full date in the tooltip
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour12: false });
function positions(s: TrackStats) {
  const list: [string, string, [number, number]][] = [
    ["start", "Start pos", s.start],
    ["end", "End pos", s.end],
  ];
  if (s.pilot) list.push(["pilot", "Pilot pos", s.pilot]);
  return list;
}
const pos = ([lat, lng]: [number, number]) =>
  `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

async function copy(key: string, text: string) {
  await copyText(text);
  copied.value = key;
  setTimeout(() => copied.value === key && (copied.value = null), 1000);
}
const sortOptions: [keyof TrackStats, string][] = [
  ["id", "Drone"],
  ["maxSpeed", "Max speed"],
  ["maxAlt", "Max alt"],
  ["zoneEntries", "Zone entries"],
  ["duration", "Flight time"],
  ["distance", "Distance"],
  ["maxPilotDist", "Max from pilot"],
  ["aboveMaxMs", `Above ${MAX_ALT_M} m`],
];
const sortKey = ref<keyof TrackStats>("id");
// Drone ID A–Z, numbers highest first
const sortedStats = computed(() =>
  [...(props.stats ?? [])].sort((a, b) =>
    sortKey.value === "id"
      ? a.id.localeCompare(b.id)
      : Number(b[sortKey.value] ?? 0) - Number(a[sortKey.value] ?? 0),
  ),
);

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
            v-if="!d.basic_id.startsWith(REPLAY_PREFIX)"
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

    <template v-if="stats?.length">
      <button
        class="header section"
        :aria-expanded="statsOpen"
        @click="statsOpen = !statsOpen"
      >
        <span>Flight stats</span>
      </button>
      <div v-if="statsOpen" class="stats">
        <label v-if="stats.length > 1" class="sort">
          Sort by
          <select v-model="sortKey">
            <option v-for="[key, label] in sortOptions" :key="key" :value="key">
              {{ label }}
            </option>
          </select>
        </label>
        <div
          v-for="s in sortedStats"
          :key="s.id"
          class="stat"
          :style="{ borderLeftColor: colorFor(s.id) }"
        >
          <dl>
            <dt>Max speed</dt>
            <dd>{{ (s.maxSpeed * 3.6).toFixed(0) }} km/h</dd>
            <dt>Max alt</dt>
            <dd>{{ Math.round(s.maxAlt) }} m</dd>
            <dt>Above {{ MAX_ALT_M }} m</dt>
            <dd :class="{ alert: s.aboveMaxMs }">
              {{ fmtDuration(s.aboveMaxMs) }}
            </dd>
            <dt>Max from {{ s.fromTakeoff ? "takeoff" : "pilot" }}</dt>
            <dd>{{ Math.round(s.maxPilotDist) }} m</dd>
            <dt>Distance</dt>
            <dd>{{ (s.distance / 1000).toFixed(2) }} km</dd>
            <dt>Prohibited entries</dt>
            <dd :class="{ alert: s.zoneEntries }">
              {{ s.zoneEntries ?? "–" }}
            </dd>
            <template v-for="(z, i) in s.zones" :key="i">
              <dt class="sub">{{ z.name }}</dt>
              <dd>{{ fmtDuration(z.ms) }}</dd>
            </template>
            <dt>Started</dt>
            <dd :title="new Date(s.startTime).toLocaleString()">
              {{ clock(s.startTime) }}
            </dd>
            <dt>Ended</dt>
            <dd :title="new Date(s.endTime).toLocaleString()">
              {{ clock(s.endTime) }}
            </dd>
            <dt>Flight time</dt>
            <dd>{{ fmtDuration(s.duration) }}</dd>
            <dt>Longest signal gap</dt>
            <dd>{{ fmtDuration(s.maxGap) }}</dd>
            <template v-for="[key, label, ll] in positions(s)" :key="key">
              <dt>{{ label }}</dt>
              <dd>
                <code>{{ pos(ll) }}</code>
                <button
                  class="action"
                  title="Copy coordinates"
                  @click="copy(s.id + key, pos(ll))"
                >
                  {{ copied === s.id + key ? "✓" : "⧉" }}
                </button>
              </dd>
            </template>
          </dl>
        </div>
      </div>
    </template>
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
.section {
  border-top: 1px solid #e5e7eb;
}
.stats {
  overflow-y: auto;
  border-top: 1px solid #e5e7eb;
}
.sort {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 0;
  font-size: 12px;
  color: #6b7280;
}
.sort select {
  font: inherit;
}
.stat {
  padding: 8px 12px 8px 9px;
  border-left: 3px solid; /* drone color, tells blocks apart in multi-drone files */
}
.stat + .stat {
  border-top: 1px solid #f3f4f6;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  margin: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
dt,
dd {
  padding: 3px 0;
  border-bottom: 1px solid #e5e7eb;
}
dt:last-of-type,
dd:last-of-type {
  border-bottom: 0;
}
dt {
  padding-right: 12px;
  color: #6b7280;
}
dd {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
dd code {
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
dd .action {
  margin: -4px -6px -4px 4px; /* keep row height */
}
dt.sub {
  padding-left: 10px;
  color: #b91c1c;
}
dd.alert {
  color: #b91c1c;
  font-weight: 600;
}
.fmt:hover {
  background: #f3f4f6;
}
</style>
