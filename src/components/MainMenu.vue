<script setup lang="ts">
import { ref } from "vue";
import Icon from "./Icon.vue";
import { stored } from "../stored";
import { source } from "../api";
import { liveStatus } from "../live";
import { t } from "../i18n";

type Mode = "monitor" | "detection";
defineProps<{
  mode: Mode;
  history: boolean; // flight logs on the Pi can be listed (live feed)
}>();
const emit = defineEmits<{
  mode: [m: Mode];
  load: [file: File];
  history: [];
  layers: [];
}>();

// Top-left menu: open by default on desktop, a hamburger on phones
const phone = () => matchMedia("(max-width: 760px)").matches;
const open = stored("geomap.open.menu", !phone());
const input = ref<HTMLInputElement>();

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) emit("load", file);
  (e.target as HTMLInputElement).value = ""; // allow loading the same file again
}
</script>

<template>
  <nav class="menu" :class="{ open }">
    <input ref="input" type="file" accept=".csv,.gpx,.kml" hidden @change="onFile" />
    <button
      class="burger"
      :title="t(open ? 'menu.close' : 'menu.open')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon :name="open ? 'close' : 'menu'" />
    </button>

    <!-- Phones: dims everything under the open menu; tap it to close -->
    <div v-if="open" class="backdrop" @click="open = false" />
    <div v-if="open" class="body">
      <div class="mode" role="tablist">
        <button
          v-for="m in ['monitor', 'detection'] as const"
          :key="m"
          role="tab"
          :aria-selected="mode === m"
          @click="emit('mode', m)"
        >
          {{ t(`mode.${m}`) }}
        </button>
      </div>

      <div class="row">
        <!-- Data source: built-in mock data or the backend live feed (dot = connection) -->
        <div class="source">
          <button
            v-for="s in ['mock', 'live'] as const"
            :key="s"
            :aria-pressed="source === s"
            :title="s === 'live' ? t(`live.${liveStatus}`) : undefined"
            @click="source = s"
          >
            <i v-if="s === 'live' && source === 'live'" class="dot" :class="liveStatus" />{{
              t(`source.${s}`)
            }}
          </button>
        </div>
        <button class="action" :title="t('replay.open')" @click="input?.click()">
          <Icon name="upload" />{{ t("replay.import") }}
        </button>
        <button v-if="history" class="action" @click="emit('history')">
          <Icon name="clock" />{{ t("history.open") }}
        </button>
        <button class="action" @click="emit('layers')">
          <Icon name="layers" />{{ t("layer.title") }}
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* Top-left: round menu button, then the tabs; data source and actions on a second row */
.menu {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1002;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: calc(100vw - 20px);
}
.burger {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--muted);
  font-size: 22px;
}
.burger:hover {
  color: var(--accent);
}
.body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.mode,
.row > * {
  background: var(--panel);
  box-shadow: var(--shadow);
}
.mode {
  display: flex;
  padding: 4px;
  border-radius: 999px;
}
.mode button {
  padding: 7px 16px;
  border-radius: 999px;
  font: 600 14px var(--font);
  color: var(--muted);
}
.mode button:hover {
  color: var(--text-strong);
}
.mode button[aria-selected="true"] {
  background: var(--accent);
  color: var(--on-accent);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.source {
  display: flex;
  padding: 3px;
  border-radius: 999px;
}
.source button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font: 600 12px var(--font);
  color: var(--muted);
}
.source button[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--accent);
}
.action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 10px;
  border-radius: 999px;
  font: 600 12px var(--font);
  color: var(--accent);
}
.action .icon {
  font-size: 16px;
}
.action:hover {
  background: var(--accent-soft);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warn); /* connecting / retrying */
}
.dot.open {
  background: var(--ok);
}
.dot.badKey,
.dot.noKey,
.dot.refused {
  background: var(--danger);
}

.backdrop {
  display: none;
}

/* Phones: one card under the menu button, everything stacked */
@media (max-width: 760px) {
  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: -1; /* under the menu, over the rest: .menu is the stacking context */
    background: rgba(15, 23, 36, 0.45);
    backdrop-filter: blur(2px);
  }
  .menu.open {
    flex-direction: column;
  }
  .body {
    align-items: stretch;
    width: calc(100vw - 20px);
    box-sizing: border-box;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .mode,
  .row > * {
    box-shadow: none;
  }
  .mode {
    background: var(--hover);
  }
  .mode button {
    flex: 1;
  }
  .row {
    flex-direction: column;
  }
  .source {
    align-self: flex-start;
    background: var(--hover);
  }
  .action {
    padding: 10px;
    border-radius: var(--radius);
    font-size: 14px;
  }
}
</style>
