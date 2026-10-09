<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { assess, READY, type AcousticTrack, type Bearing } from "../acoustic";
import { SENSOR_TYPES, type Sensor } from "../composables/useSensors";
import { fmtPos } from "../geo";
import { t, type MsgKey } from "../i18n";

const props = defineProps<{
  track: AcousticTrack | null;
  hearing: Bearing[];
  sensors: Sensor[];
}>();
const emit = defineEmits<{ select: [s: Sensor] }>();

// Recomputed every poll: track and hearing are replaced each tick
const ready = computed(() => (props.track ? assess(props.track, Date.now()) : null));
const last = computed(() => props.track?.fixes[props.track.fixes.length - 1]);
const audio = computed(() => props.sensors.filter((s) => s.type === "audio"));
const bearingOf = (s: Sensor) => props.hearing.find((b) => b.sensorId === s.id);

const checks = computed(() => {
  const r = ready.value, f = last.value, h = props.track?.heading;
  if (!r || !f) return [];
  const row = (key: MsgKey, ok: boolean, value: string, need: string) => ({ key, ok, value, need });
  return [
    row("det.sensors", r.sensors, String(f.sensors), `≥ ${READY.minSensors}`),
    row("det.position", r.position, `±${f.errM.toFixed(0)} m`, `≤ ${READY.maxErrM} m`),
    row("det.heading", r.heading, h ? `±${h.sigmaDeg.toFixed(0)}°` : "–", `≤ ±${READY.maxHeadingSigmaDeg}°`),
    row("det.fresh", r.fresh, `${((Date.now() - f.t) / 1000).toFixed(0)} s`, `≤ ${READY.maxAgeS} s`),
  ];
});
</script>

<template>
  <section class="side-panel">
    <header class="head">
      <span class="panel-title"><Icon name="mic" />{{ t("det.title") }}</span>
    </header>

    <div
      class="verdict"
      :class="!track ? 'none' : ready?.ok ? 'ok' : 'bad'"
      role="status"
    >
      <b>{{ !track ? t("det.noTarget") : ready?.ok ? "OK" : "NOT OK" }}</b>
      <span>{{ !track ? (hearing.length ? t("det.oneSensor") : t("det.quiet")) : ready?.ok ? t("det.ok") : t("det.notOk") }}</span>
    </div>

    <ul v-if="checks.length" class="checks">
      <li v-for="c in checks" :key="c.key" :class="c.ok ? 'pass' : 'fail'">
        <Icon :name="c.ok ? 'check' : 'close'" />
        <span class="label">{{ t(c.key) }}</span>
        <b>{{ c.value }}</b>
        <span class="need">{{ c.need }}</span>
      </li>
    </ul>

    <div v-if="last" class="target">
      <code>{{ fmtPos(last.lat, last.lng) }}</code>
      <div v-if="track?.heading">
        {{ t("acoustic.heading") }}: <b>{{ track.heading.deg.toFixed(0) }}°</b> ·
        {{ (track.heading.speed * 3.6).toFixed(0) }} km/h
      </div>
    </div>

    <h3 class="sub">{{ t("det.sensorsTitle", { n: hearing.length, total: audio.length }) }}</h3>
    <ul class="list">
      <li v-if="!audio.length" class="empty">{{ t("det.noSensors") }}</li>
      <li
        v-for="s in audio"
        :key="s.id"
        class="item"
        :class="{ on: bearingOf(s) }"
        @click="emit('select', s)"
      >
        <span class="sq" :style="{ background: bearingOf(s) ? SENSOR_TYPES.audio.color : 'var(--faint)' }">
          <Icon name="mic" />
        </span>
        <span class="name">{{ t("plan.audio") }} #{{ s.id }}</span>
        <span class="state">
          <template v-if="bearingOf(s)">{{ bearingOf(s)!.deg.toFixed(0) }}° ±{{ bearingOf(s)!.sigmaDeg }}°</template>
          <template v-else>{{ t("det.silent") }}</template>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.head {
  padding: 12px 16px 8px;
}
.verdict {
  margin: 4px 16px 10px;
  padding: 12px 14px;
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.verdict b {
  font-family: var(--font-head);
  font-size: 28px;
  line-height: 1;
}
.verdict.ok {
  background: var(--ok-bg);
  color: var(--ok);
}
.verdict.bad {
  background: var(--danger-bg);
  color: var(--danger);
}
.verdict.none {
  background: var(--hover);
  color: var(--muted);
}
.checks {
  list-style: none;
  margin: 0 16px 10px;
  padding: 0;
}
.checks li {
  display: grid;
  grid-template-columns: 18px 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.pass .icon {
  color: var(--ok);
}
.fail .icon {
  color: var(--danger);
}
.need {
  color: var(--muted);
  font-size: 12px;
  min-width: 52px;
  text-align: right;
}
.target {
  margin: 0 16px 10px;
}
code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
.sub {
  margin: 0;
  padding: 10px 16px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  border-top: 1px solid var(--line);
}
.list {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 0 0 6px;
  overflow-y: auto;
}
.empty {
  padding: 12px 16px;
  color: var(--muted);
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 8px 0;
  padding: 6px 8px;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--muted);
}
.item:hover {
  background: var(--hover);
}
.item.on {
  color: var(--text-strong);
}
.sq {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 16px;
}
.name {
  flex: 1;
  font-weight: 600;
}
.state {
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
