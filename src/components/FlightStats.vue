<script setup lang="ts">
import { ref } from "vue";
import { copyText } from "../export";
import { MAX_ALT_M } from "../config";
import { fmtDuration, type TrackStats } from "../composables/useReplay";

// live: flight still in progress, so there is no end time / end position yet
const props = defineProps<{ s: TrackStats; live?: boolean }>();

const copied = ref<string | null>(null);
// Local clock time; full date in the tooltip
const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour12: false });
const pos = ([lat, lng]: [number, number]) =>
  `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

function positions() {
  const s = props.s;
  const list: [string, string, [number, number]][] = [["start", "Start pos", s.start]];
  if (!props.live) list.push(["end", "End pos", s.end]);
  if (s.pilot) list.push(["pilot", "Pilot pos", s.pilot]);
  return list;
}

async function copy(key: string, text: string) {
  await copyText(text);
  copied.value = key;
  setTimeout(() => copied.value === key && (copied.value = null), 1000);
}
</script>

<template>
  <dl>
    <dt>Max speed</dt>
    <dd>{{ (s.maxSpeed * 3.6).toFixed(0) }} km/h</dd>
    <dt>Max alt</dt>
    <dd>{{ Math.round(s.maxAlt) }} m</dd>
    <dt>Above {{ MAX_ALT_M }} m</dt>
    <dd :class="{ alert: s.aboveMaxMs }">{{ fmtDuration(s.aboveMaxMs) }}</dd>
    <dt>Max from {{ s.fromTakeoff ? "takeoff" : "pilot" }}</dt>
    <dd>{{ Math.round(s.maxPilotDist) }} m</dd>
    <dt>Distance</dt>
    <dd>{{ (s.distance / 1000).toFixed(2) }} km</dd>
    <dt>Prohibited entries</dt>
    <dd :class="{ alert: s.zoneEntries }">{{ s.zoneEntries ?? "–" }}</dd>
    <template v-for="(z, i) in s.zones" :key="i">
      <dt class="sub">{{ z.name }}</dt>
      <dd>{{ fmtDuration(z.ms) }}</dd>
    </template>
    <dt>Started</dt>
    <dd :title="new Date(s.startTime).toLocaleString()">
      {{ clock(s.startTime) }}
    </dd>
    <template v-if="!live">
      <dt>Ended</dt>
      <dd :title="new Date(s.endTime).toLocaleString()">
        {{ clock(s.endTime) }}
      </dd>
    </template>
    <dt>Flight time</dt>
    <dd>{{ fmtDuration(s.endTime - s.startTime) }}</dd>
    <dt>Longest signal gap</dt>
    <dd>{{ fmtDuration(s.maxGap) }}</dd>
    <template v-for="[key, label, ll] in positions()" :key="key">
      <dt>{{ label }}</dt>
      <dd>
        <code>{{ pos(ll) }}</code>
        <button
          class="copy"
          title="Copy coordinates"
          @click="copy(s.id + key, pos(ll))"
        >
          {{ copied === s.id + key ? "✓" : "⧉" }}
        </button>
      </dd>
    </template>
  </dl>
</template>

<style scoped>
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
dt.sub {
  padding-left: 10px;
  color: #b91c1c;
}
dd.alert {
  color: #b91c1c;
  font-weight: 600;
}
/* Same look as the list's icon buttons */
.copy {
  flex: none;
  width: 26px;
  height: 26px;
  margin: -4px -6px -4px 4px; /* keep row height */
  border: 0;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 15px;
  color: #6b7280;
}
.copy:hover {
  background: #e5e7eb;
  color: #111827;
}
</style>
