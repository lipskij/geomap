<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import {
  rangeOf,
  SENSOR_TYPES,
  type Plan,
  type Sensor,
  type SensorType,
} from "../composables/useSensors";
import { downloadPlan, exportSensors } from "../export";
import { distanceM, fmtPos } from "../geo";
import { parsePlan, parsePlanCsv } from "../plans";
import { t, type MsgKey } from "../i18n";

const props = defineProps<{
  name: string;
  sensors: Sensor[];
  placing: SensorType | null;
  overlap: SensorType | "all" | null;
  saveError: string | null;
  showLive: boolean;
}>();
const emit = defineEmits<{
  pick: [type: SensorType | null];
  select: [s: Sensor];
  remove: [id: number];
  clear: [];
  rename: [name: string];
  overlap: [value: SensorType | "all" | null];
  import: [plan: Plan];
  showLive: [on: boolean];
}>();

const types = Object.keys(SENSOR_TYPES) as SensorType[];
const typeName = (type: SensorType) => t(`plan.${type}` as MsgKey);
const plan = (): Plan => ({ name: props.name, sensors: props.sensors });

// Deployment summary: how many of each type the plan needs
const counts = computed(() =>
  types
    .map((type) => [type, props.sensors.filter((s) => s.type === type).length] as const)
    .filter(([, n]) => n),
);

// Other sensors whose coverage overlaps this one (same type when the overlap view is
// limited to one type); null when the sensor isn't part of the overlap view
function overlaps(s: Sensor): number | null {
  const pick = props.overlap ?? "all";
  if (pick !== "all" && s.type !== pick) return null;
  return props.sensors.filter(
    (o) =>
      o.id !== s.id &&
      (pick === "all" || o.type === pick) &&
      distanceM(s, o) < rangeOf(s) + rangeOf(o),
  ).length;
}

function onDragStart(e: DragEvent, type: SensorType) {
  e.dataTransfer?.setData("text/x-sensor", type);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
}

function onClear() {
  if (confirm(t("plan.clearConfirm"))) emit("clear");
}

// Download opens a format menu: CSV deployment list (first) or the re-importable JSON plan
const menuOpen = ref(false);
function onMenuBlur(e: FocusEvent) {
  const box = e.currentTarget as HTMLElement;
  if (!box.contains(e.relatedTarget as Node)) menuOpen.value = false;
}
function download(kind: "csv" | "json") {
  menuOpen.value = false;
  if (kind === "csv") exportSensors(plan());
  else downloadPlan(plan());
}

const fileInput = ref<HTMLInputElement>();
const importError = ref<string | null>(null);

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // allow importing the same file again
  if (!file) return;
  try {
    const text = await file.text();
    const p = /\.csv$/i.test(file.name) ? parsePlanCsv(text) : parsePlan(text);
    if (!p.sensors.length) throw new Error(t("plan.importEmpty"));
    if (props.sensors.length && !confirm(t("plan.replaceConfirm"))) return;
    importError.value = null;
    // Name from the file, minus extension and the download timestamp
    const fromFile = file.name
      .replace(/(_\d{4}(-\d{2}){5})?\.(json|csv)$/i, "")
      .replace(/_/g, " ");
    emit("import", { name: p.name || fromFile, sensors: p.sensors });
  } catch (err) {
    importError.value = t("plan.importError", { e: (err as Error).message });
  }
}
</script>

<template>
  <section class="side-panel">
    <header class="head">
      <span class="panel-title"><Icon name="sensors" />{{ t("plan.title") }}</span>
      <input
        class="plan-name"
        :value="name"
        :placeholder="t('plan.namePlaceholder')"
        maxlength="100"
        @change="emit('rename', ($event.target as HTMLInputElement).value.trim())"
      />
    </header>

    <div class="palette">
      <button
        v-for="type in types"
        :key="type"
        class="tool"
        :class="{ active: placing === type }"
        draggable="true"
        :aria-pressed="placing === type"
        :title="`${typeName(type)} · ${SENSOR_TYPES[type].range} m`"
        @dragstart="onDragStart($event, type)"
        @click="emit('pick', placing === type ? null : type)"
      >
        <span class="sq" :style="{ background: SENSOR_TYPES[type].color }">
          <Icon :name="SENSOR_TYPES[type].icon" />
        </span>
        {{ typeName(type) }}
      </button>
    </div>
    <p class="hint">{{ t("plan.hint") }}</p>

    <div class="overlap">
      <label class="check live">
        <input
          type="checkbox"
          :checked="showLive"
          @change="emit('showLive', ($event.target as HTMLInputElement).checked)"
        />
        {{ t("plan.showLive") }}
      </label>
      <label class="check">
        {{ t("plan.overlap") }}
        <select
          :value="overlap ?? ''"
          @change="
            emit(
              'overlap',
              (($event.target as HTMLSelectElement).value || null) as SensorType | 'all' | null,
            )
          "
        >
          <option value="">{{ t("plan.off") }}</option>
          <option value="all">{{ t("plan.allTypes") }}</option>
          <option v-for="type in types" :key="type" :value="type">{{ typeName(type) }}</option>
        </select>
      </label>
      <div v-if="overlap !== null" class="legend">
        <span><i class="two" />{{ t("plan.overlap2") }}</span>
        <span><i class="three" />{{ t("plan.overlap3") }}</span>
        <span><i class="hidden" />{{ t("plan.hidden") }}</span>
      </div>
    </div>

    <div v-if="counts.length" class="summary">
      <span v-for="[type, n] in counts" :key="type" class="chip">
        <b>{{ n }}×</b> {{ typeName(type) }}
      </span>
      <span class="total">{{ t("plan.total", { n: sensors.length }) }}</span>
      <button class="clear" :title="t('plan.clear')" @click="onClear">
        <Icon name="trash" />
      </button>
    </div>

    <ul class="list">
      <li v-if="!sensors.length" class="empty">{{ t("plan.empty") }}</li>
      <li v-for="s in sensors" :key="s.id" class="item">
        <button class="row" @click="emit('select', s)">
          <span class="sq" :style="{ background: SENSOR_TYPES[s.type].color }">
            <Icon :name="SENSOR_TYPES[s.type].icon" />
          </span>
          <span class="main">
            <span class="name">{{ typeName(s.type) }} #{{ s.id }}</span>
            <code>{{ fmtPos(s.lat, s.lng) }}</code>
            <span class="meta">
              {{ rangeOf(s) }} m
              <template v-if="overlaps(s) !== null">
                · {{ t("plan.overlapsWith", { n: overlaps(s)! }) }}
              </template>
            </span>
          </span>
        </button>
        <button class="action" :title="t('plan.remove')" @click="emit('remove', s.id)">
          <Icon name="trash" />
        </button>
      </li>
    </ul>

    <p v-if="importError" class="err">{{ importError }}</p>
    <p v-if="saveError" class="err">{{ t("plan.saveError", { e: saveError }) }}</p>

    <footer class="foot">
      <input ref="fileInput" type="file" accept=".csv,.json,text/csv,application/json" hidden @change="onImport" />
      <button class="pill" :title="t('plan.importTitle')" @click="fileInput?.click()">
        <Icon name="upload" />{{ t("plan.import") }}
      </button>
      <div v-if="sensors.length" class="dl-menu" @focusout="onMenuBlur">
        <button
          class="pill primary"
          :aria-expanded="menuOpen"
          aria-haspopup="menu"
          @click="menuOpen = !menuOpen"
        >
          <Icon name="download" />{{ t("plan.download") }}
          <Icon name="expand" class="chev" />
        </button>
        <div v-if="menuOpen" class="menu" role="menu">
          <button role="menuitem" @click="download('csv')">
            <Icon name="file" />
            <span><b>CSV</b><small>{{ t("plan.csvTitle") }}</small></span>
          </button>
          <button role="menuitem" @click="download('json')">
            <Icon name="file" />
            <span><b>JSON</b><small>{{ t("plan.downloadTitle") }}</small></span>
          </button>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.head {
  padding: 12px 16px 8px;
}
.plan-name {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text-strong);
  font: 600 14px var(--font);
}
.plan-name:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.palette {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 0 12px;
}
.tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px 8px;
  border-radius: var(--radius);
  background: var(--hover);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  cursor: grab;
}
.tool:hover {
  box-shadow: inset 0 0 0 1px var(--line);
}
.tool.active {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 2px var(--accent);
}
.sq {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: #fff;
  font-size: 19px;
}
.hint {
  margin: 8px 16px 10px;
  font-size: 12px;
  color: var(--muted);
}
.overlap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  font-size: 13px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  cursor: pointer;
}
.check.live {
  width: 100%;
}
.check input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent);
}
.overlap .check:not(.live) {
  width: 100%;
  justify-content: space-between;
}
.overlap select {
  padding: 3px 8px;
  border: 0;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  width: 100%;
  font-size: 12px;
  color: var(--muted);
}
.legend span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
/* Same colours as the map shading in coverage.ts */
.legend .two {
  background: rgba(245, 166, 35, 0.55);
}
.legend .three {
  background: rgba(24, 160, 80, 0.6);
}
.legend .hidden {
  background: rgba(90, 90, 90, 0.6);
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.err {
  margin: 0;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--danger);
  border-top: 1px solid var(--line);
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}
.chip {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
.total {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.list {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 0 0 6px;
  overflow-y: auto;
  border-top: 1px solid var(--line);
}
.empty {
  padding: 12px 16px;
  color: var(--muted);
}
.item {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px 8px 0;
  padding-right: 4px;
  border-radius: var(--radius);
}
.item:hover {
  background: var(--hover);
}
.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px 7px 8px;
}
.row .sq {
  width: 28px;
  height: 28px;
  font-size: 17px;
}
.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 600;
  color: var(--text-strong);
}
code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
.action {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 16px;
  color: var(--muted);
}
.action:hover {
  background: var(--danger-bg);
  color: var(--danger);
}
.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--line);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--hover);
  font-weight: 600;
}
.clear {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 15px;
  color: var(--danger);
}
.clear:hover {
  background: var(--danger-bg);
}
.dl-menu {
  position: relative;
  display: flex;
  margin-left: auto;
}
.chev {
  font-size: 18px;
  margin-right: -6px;
  transition: transform 0.15s;
}
[aria-expanded="true"] .chev {
  transform: rotate(180deg);
}
/* Opens upwards: the footer is at the bottom of the panel */
.menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 1;
  width: 250px;
  padding: 6px;
  background: var(--panel);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.menu button {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
}
.menu button:hover,
.menu button:focus-visible {
  background: var(--hover);
}
.menu .icon {
  margin-top: 2px;
  font-size: 16px;
  color: var(--accent);
}
.menu b {
  display: block;
  color: var(--text-strong);
}
.menu small {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.pill.primary {
  background: var(--accent);
  color: var(--on-accent);
}
</style>
