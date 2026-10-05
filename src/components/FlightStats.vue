<script setup lang="ts">
import { computed, ref } from "vue";
import { colorFor } from "../colors";
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

// Altitude chart: SVG in a fixed viewBox stretched to the card width
const W = 300;
const H = 48;
const chart = computed(() => {
  const p = props.s.altProfile;
  if (p.length < 2) return null;
  const t0 = p[0][0];
  const span = p[p.length - 1][0] - t0 || 1;
  const top = Math.max(props.s.maxAlt, MAX_ALT_M) * 1.15;
  const x = (t: number) => ((t - t0) / span) * W;
  const y = (alt: number) => H - (Math.max(0, alt) / top) * H;
  return {
    line: p.map(([t, a]) => `${x(t).toFixed(1)},${y(a).toFixed(1)}`).join(" "),
    limitY: y(MAX_ALT_M),
    x,
    y,
  };
});
const hover = ref<number | null>(null); // index into altProfile

function onMove(e: PointerEvent) {
  const p = props.s.altProfile;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const t = p[0][0] + ((e.clientX - rect.left) / rect.width) * (p[p.length - 1][0] - p[0][0]);
  let best = 0;
  p.forEach(([pt], i) => {
    if (Math.abs(pt - t) < Math.abs(p[best][0] - t)) best = i;
  });
  hover.value = best;
}

async function copy(key: string, text: string) {
  await copyText(text);
  copied.value = key;
  setTimeout(() => copied.value === key && (copied.value = null), 1000);
}
</script>

<template>
  <div v-if="chart" class="alt">
    <div class="alt-head">
      <span>Altitude</span>
      <span v-if="hover !== null">
        {{ clock(s.altProfile[hover][0]) }} ·
        {{ Math.round(s.altProfile[hover][1]) }} m
      </span>
    </div>
    <div class="plot" @pointermove="onMove" @pointerleave="hover = null">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="`Altitude over time, max ${Math.round(s.maxAlt)} m`"
      >
        <line class="base" x1="0" :y1="H" :x2="W" :y2="H" />
        <line class="limit" x1="0" :y1="chart.limitY" :x2="W" :y2="chart.limitY" />
        <polyline :points="chart.line" :stroke="colorFor(s.id)" />
        <line
          v-if="hover !== null"
          class="cross"
          :x1="chart.x(s.altProfile[hover][0])"
          y1="0"
          :x2="chart.x(s.altProfile[hover][0])"
          :y2="H"
        />
      </svg>
      <span class="limit-label" :style="{ top: `${(chart.limitY / H) * 100}%` }">
        {{ MAX_ALT_M }} m
      </span>
      <span
        v-if="hover !== null"
        class="dot"
        :style="{
          left: `${(chart.x(s.altProfile[hover][0]) / W) * 100}%`,
          top: `${(chart.y(s.altProfile[hover][1]) / H) * 100}%`,
          background: colorFor(s.id),
        }"
      />
    </div>
  </div>
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
.alt {
  margin-bottom: 6px;
  font-size: 12px;
}
.alt-head {
  display: flex;
  justify-content: space-between;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}
.plot {
  position: relative;
  height: 48px;
  margin-top: 2px;
  touch-action: none; /* drag on touch screens scrubs instead of scrolling */
}
.plot svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.plot line,
.plot polyline {
  vector-effect: non-scaling-stroke;
  fill: none;
}
.plot polyline {
  stroke-width: 2;
  stroke-linejoin: round;
}
.base {
  stroke: #e5e7eb;
  stroke-width: 1;
}
.limit {
  stroke: #b91c1c;
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.cross {
  stroke: #9ca3af;
  stroke-width: 1;
}
.limit-label {
  position: absolute;
  right: 0;
  transform: translateY(-100%);
  font-size: 10px;
  line-height: 1.2;
  color: #b91c1c;
  pointer-events: none;
}
.dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #fff;
  transform: translate(-50%, -50%);
  pointer-events: none;
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
