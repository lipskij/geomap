<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import type { Snapshot } from "../live";
import { t } from "../i18n";

// Camera image shown large; Esc or a click outside closes it. floating: a window over the
// map instead (live camera), dragged by its title bar, resized from its corner
const props = defineProps<{ snapshot: Snapshot | null; floating?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dlg = ref<HTMLDialogElement>();
const pos = reactive({ x: 0, y: 0 });
watch(
  () => props.snapshot,
  (s) => {
    if (!s) return dlg.value?.close();
    if (dlg.value?.open) return; // a newer image just swaps in
    if (!props.floating) return dlg.value?.showModal();
    pos.x = Math.max(8, (innerWidth - Math.min(640, innerWidth - 16)) / 2);
    pos.y = 72;
    dlg.value?.show();
  },
);

function drag(e: PointerEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
  const bar = e.currentTarget as HTMLElement;
  const dx = e.clientX - pos.x, dy = e.clientY - pos.y;
  // Keep the title bar on screen so the window can always be grabbed again
  const move = (m: PointerEvent) => {
    pos.x = Math.min(Math.max(m.clientX - dx, 80 - bar.offsetWidth), innerWidth - 80);
    pos.y = Math.min(Math.max(m.clientY - dy, 0), innerHeight - 40);
  };
  bar.setPointerCapture(e.pointerId);
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", () => bar.removeEventListener("pointermove", move), { once: true });
}

const caption = (s: Snapshot) =>
  t("popup.snapshot", { node: s.node, time: new Date(s.ts).toLocaleTimeString() }) +
  (s.url && s.status === "ended" ? ` · ${t("viewer.ended")}` : "");
</script>

<template>
  <Teleport to="body">
  <dialog
    ref="dlg"
    class="viewer"
    :class="{ floating }"
    :style="floating ? { left: `${pos.x}px`, top: `${pos.y}px` } : undefined"
    @close="emit('close')"
    @click.self="!floating && emit('close')"
  >
    <figure v-if="snapshot">
      <div v-if="floating" class="bar" @pointerdown="drag">
        <span>{{ caption(snapshot) }}</span>
        <button class="x" :aria-label="t('viewer.close')" :title="t('viewer.close')" @click="emit('close')">✕</button>
      </div>
      <img v-if="snapshot.url" :src="snapshot.url" alt="" />
      <div v-else class="wait">{{ t(snapshot.status === "ended" ? "viewer.ended" : "viewer.loading") }}</div>
      <figcaption v-if="!floating">{{ caption(snapshot) }}</figcaption>
    </figure>
  </dialog>
  </Teleport>
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
figcaption {
  margin-top: 6px;
  font-size: 13px;
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

.floating {
  position: fixed;
  inset: auto;
  margin: 0;
  z-index: 2000; /* above the map and panels */
  width: min(640px, calc(100vw - 16px));
  min-width: 220px;
  min-height: 160px;
  max-width: 100vw;
  max-height: 100vh;
  padding: 0 8px 8px;
  resize: both;
  overflow: hidden;
}
.floating figure {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.floating img,
.floating .wait {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-height: none;
  object-fit: contain;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  cursor: move;
  touch-action: none; /* dragging, not page scroll, on touch screens */
  user-select: none;
}
.bar span {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.x {
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--muted);
}
.x:hover,
.x:focus-visible {
  background: var(--hover);
  color: var(--text);
}
</style>
