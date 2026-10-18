<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { deleteHistory, fetchHistory, historyFile, type HistoryEntry } from "../live";
import { fmtDuration } from "../composables/useReplay";
import { locale, t } from "../i18n";
import Icon from "./Icon.vue";

// Flight logs kept on the Pi: replay one, or delete some for good
const emit = defineEmits<{ replay: [file: File]; close: [] }>();

const entries = ref<HistoryEntry[] | null>(null); // null = loading
const error = ref<string | null>(null);
const picked = ref(new Set<string>());
const busy = ref(false);

const allPicked = computed(
  () => !!entries.value?.length && entries.value.every((e) => picked.value.has(e.id)),
);

async function load() {
  error.value = null;
  try {
    entries.value = await fetchHistory();
    const ids = new Set(entries.value.map((e) => e.id));
    picked.value = new Set([...picked.value].filter((id) => ids.has(id)));
  } catch (e) {
    entries.value ??= [];
    error.value = (e as Error).message;
  }
}
onMounted(load);

function toggle(id: string) {
  const next = new Set(picked.value);
  if (!next.delete(id)) next.add(id);
  picked.value = next;
}
const toggleAll = () =>
  (picked.value = allPicked.value ? new Set() : new Set(entries.value!.map((e) => e.id)));

async function replay(id: string) {
  busy.value = true;
  try {
    emit("replay", await historyFile(id));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function remove() {
  const ids = [...picked.value];
  if (!confirm(t("history.confirmDelete", { n: ids.length }))) return;
  busy.value = true;
  try {
    await deleteHistory(ids);
    picked.value = new Set();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
const length = (e: HistoryEntry) => fmtDuration(Date.parse(e.end) - Date.parse(e.start));
</script>

<template>
  <section class="history">
    <div class="head">
      <h2>{{ t("history.title") }}</h2>
      <button class="icon" :title="t('replay.close')" @click="emit('close')">
        <Icon name="close" />
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!entries" class="empty">{{ t("history.loading") }}</p>
    <p v-else-if="!entries.length && !error" class="empty">{{ t("history.empty") }}</p>
    <template v-else-if="entries.length">
      <label class="all">
        <input type="checkbox" :checked="allPicked" @change="toggleAll" />
        {{ t("history.selectAll") }}
      </label>
      <ul>
        <li v-for="e in entries" :key="e.id">
          <input
            type="checkbox"
            :checked="picked.has(e.id)"
            :aria-label="e.uas_id"
            @change="toggle(e.id)"
          />
          <span class="info">
            <span class="id" :title="e.uas_id">{{ e.uas_id }}</span>
            <span class="meta">{{ when(e.start) }} · {{ length(e) }}</span>
          </span>
          <button class="replay" :disabled="busy" @click="replay(e.id)">
            {{ t("history.replay") }}
          </button>
        </li>
      </ul>
      <button class="delete" :disabled="busy || !picked.size" @click="remove">
        <Icon name="trash" />
        {{ t("history.delete", { n: picked.size }) }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.history {
  position: absolute;
  top: 64px;
  right: 340px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 380px;
  max-width: calc(100vw - 360px);
  max-height: 60vh;
  padding: 12px 16px 14px;
  background: var(--panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  font: var(--font-size) var(--font);
  color: var(--text);
  box-sizing: border-box;
}
/* Narrow screens: above the replay pill at the bottom-left */
@media (max-width: 760px) {
  .history {
    top: auto;
    right: auto;
    left: 10px;
    bottom: 72px;
    width: calc(100vw - 20px);
    max-width: none;
  }
}
.head {
  display: flex;
  align-items: center;
}
h2 {
  flex: 1;
  margin: 0;
  font: 700 15px var(--font-head);
  letter-spacing: 0.02em;
  color: var(--text-strong);
}
button.icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 16px;
  color: var(--muted);
}
button.icon:hover {
  background: var(--hover);
  color: var(--text-strong);
}
.empty,
.error {
  margin: 0;
  color: var(--muted);
}
.error {
  color: var(--danger);
}
.all {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
ul {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--line);
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-strong);
}
.meta {
  font-size: 12px;
  color: var(--muted);
}
.replay {
  padding: 4px 12px;
  border-radius: 999px;
  font-weight: 600;
  color: var(--accent);
}
.replay:hover:not(:disabled) {
  background: var(--accent-soft);
}
.delete {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  border-radius: var(--radius);
  font-weight: 600;
  color: var(--danger);
  background: var(--danger-bg);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
