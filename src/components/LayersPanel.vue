<script setup lang="ts">
import { ref } from "vue";
import Icon from "./Icon.vue";
import type { BaseLayer } from "./MapView.vue";
import { LANGS, lang, t, type MsgKey } from "../i18n";

defineProps<{ base: BaseLayer; showZones: boolean; zonesAvailable: boolean; showSensors: boolean }>();
const emit = defineEmits<{
  "update:base": [value: BaseLayer];
  "update:showZones": [value: boolean];
  "update:showSensors": [value: boolean];
}>();

const open = ref(false);

// One central Vilnius tile as the preview; light/dark reuse the map's CSS recolouring
const OSM_TILE = "https://tile.openstreetmap.org/13/4671/2603.png";
const bases: { key: BaseLayer; src: string; cls?: string }[] = [
  { key: "light", src: OSM_TILE, cls: "light-tiles" },
  { key: "dark", src: OSM_TILE, cls: "dark-tiles" },
  { key: "map", src: OSM_TILE },
  {
    key: "satellite",
    src: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/2603/4671",
  },
];
const desc = (key: BaseLayer) => `layer.${key}.desc` as MsgKey;
</script>

<template>
  <button
    v-if="!open"
    class="fab"
    :title="t('layer.title')"
    @click="open = true"
  >
    <Icon name="layers" />
  </button>

  <section v-else class="sheet">
    <button class="close" :title="t('layer.close')" @click="open = false">
      <Icon name="close" />
    </button>

    <div class="col">
      <h3>{{ t("layer.base") }}</h3>
      <button
        v-for="b in bases"
        :key="b.key"
        class="base"
        :class="{ active: base === b.key }"
        @click="emit('update:base', b.key)"
      >
        <img :src="b.src" :class="b.cls" alt="" loading="lazy" />
        <span>
          <span class="name">{{ t(`layer.${b.key}`) }}</span>
          <span class="desc">{{ t(desc(b.key)) }}</span>
        </span>
      </button>
    </div>

    <div class="col">
      <h3>{{ t("layer.overlays") }}</h3>
      <label class="check" :class="{ off: !zonesAvailable }">
        <input
          type="checkbox"
          :checked="showZones"
          :disabled="!zonesAvailable"
          @change="
            emit('update:showZones', ($event.target as HTMLInputElement).checked)
          "
        />
        <span>
          <span class="name">{{ t("layer.zones") }}</span>
          <span class="desc">{{
            t(zonesAvailable ? "layer.zones.desc" : "layer.zones.off")
          }}</span>
        </span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="showSensors"
          @change="emit('update:showSensors', ($event.target as HTMLInputElement).checked)"
        />
        <span>
          <span class="name">{{ t("layer.sensors") }}</span>
          <span class="desc">{{ t("layer.sensors.desc") }}</span>
        </span>
      </label>
    </div>

    <div class="col">
      <h3>{{ t("layer.language") }}</h3>
      <div class="segment">
        <button
          v-for="[value, name] in LANGS"
          :key="value"
          :class="{ active: lang === value }"
          @click="lang = value"
        >
          {{ name }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fab {
  position: absolute;
  right: 12px;
  bottom: 28px;
  z-index: 1000;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--panel);
  color: var(--muted);
  box-shadow: var(--shadow);
  font-size: 22px;
}
.fab:hover {
  color: var(--accent);
}
.sheet {
  position: absolute;
  /* Centred in the map area left of the drone panel (320 px + 2 × 10 px) */
  left: calc((100% - 340px) / 2);
  bottom: 20px;
  z-index: 1001;
  transform: translateX(-50%);
  width: min(820px, calc(100vw - 360px));
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px 28px;
  padding: 22px 26px;
  background: var(--panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  font: var(--font-size) var(--font);
  color: var(--text);
}
@media (max-width: 760px) {
  .sheet {
    left: 50%;
    width: calc(100vw - 24px);
  }
}
.close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--hover);
  color: var(--muted);
  font-size: 18px;
}
.close:hover {
  color: var(--text-strong);
}
h3 {
  margin: 0 0 10px;
  font: 600 14px var(--font-head);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-strong);
}
.base {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px;
  margin: 0 -6px 4px;
  border-radius: 10px;
}
.base:hover {
  background: var(--hover);
}
.base img {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 0 0 1px var(--line);
}
.base.active img {
  box-shadow: 0 0 0 2px var(--accent);
}
.base.active .name,
.base.active .desc {
  color: var(--accent);
}
.name {
  display: block;
  font-weight: 600;
}
.desc {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}
.check input {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: var(--accent);
}
.check.off {
  cursor: default;
  opacity: 0.55;
}
.segment {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--hover);
}
.segment button {
  padding: 5px 14px;
  border-radius: 999px;
  font-weight: 600;
  color: var(--muted);
}
.segment button.active {
  background: var(--accent);
  color: var(--on-accent);
}
</style>
