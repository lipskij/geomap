<script setup lang="ts">
import { ref, watch } from "vue";
import type { Snapshot } from "../live";
import { t } from "../i18n";

// Camera image shown large; Esc or a click outside closes it
const props = defineProps<{ snapshot: Snapshot | null }>();
const emit = defineEmits<{ close: [] }>();
const dlg = ref<HTMLDialogElement>();
watch(
  () => props.snapshot,
  (s) => {
    if (!s) dlg.value?.close();
    else if (!dlg.value?.open) dlg.value?.showModal(); // a newer image just swaps in
  },
);
</script>

<template>
  <dialog ref="dlg" class="viewer" @close="emit('close')" @click.self="emit('close')">
    <figure v-if="snapshot">
      <img v-if="snapshot.url" :src="snapshot.url" alt="" />
      <div v-else class="wait">{{ t(snapshot.status === "ended" ? "viewer.ended" : "viewer.loading") }}</div>
      <figcaption>
        {{ t("popup.snapshot", { node: snapshot.node, time: new Date(snapshot.ts).toLocaleTimeString() }) }}
        <template v-if="snapshot.url && snapshot.status === 'ended'"> · {{ t("viewer.ended") }}</template>
      </figcaption>
    </figure>
  </dialog>
</template>

<style scoped>
.viewer {
  max-width: min(92vw, 900px);
  padding: 10px;
  border: 0;
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow);
}
.viewer::backdrop {
  background: rgba(10, 15, 25, 0.6);
}
img {
  display: block;
  max-width: 100%;
  max-height: 75vh;
  border-radius: 8px;
}
figure {
  margin: 0;
}
.wait {
  display: grid;
  place-items: center;
  width: min(80vw, 640px);
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  background: var(--faint);
  color: var(--muted);
}
figcaption {
  margin-top: 6px;
  font-size: 13px;
}
</style>
