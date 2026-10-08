<script setup lang="ts">
import type { Toast } from "../composables/useToasts";
import { colorFor } from "../colors";
import { t } from "../i18n";

defineProps<{ toasts: Toast[] }>();
const emit = defineEmits<{
  select: [droneId: string];
  dismiss: [key: number];
}>();
</script>

<template>
  <TransitionGroup tag="div" name="toast" class="stack">
    <div
      v-for="toast in toasts"
      :key="toast.key"
      class="toast"
      :class="toast.kind"
      @click="emit('select', toast.droneId)"
    >
      <span class="swatch" :style="{ background: colorFor(toast.droneId) }" />
      <span class="body">
        <span class="title">{{ t(toast.msg, toast.params) }}</span>
        <span class="id">{{ toast.droneId }}</span>
      </span>
      <button
        class="close"
        :title="t('toast.dismiss')"
        @click.stop="emit('dismiss', toast.key)"
      >
        ×
      </button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
/* Left side, below the zoom control, so it never covers the drone list */
.stack {
  position: absolute;
  top: 84px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 260px;
  max-width: calc(100vw - 20px);
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--panel);
  border-radius: 2px;
  box-shadow: var(--shadow);
  font:
    13px/1.3 system-ui,
    sans-serif;
  color: var(--text);
  cursor: pointer;
}
.toast.alert {
  border-left: 4px solid var(--danger);
}
.toast.alert .title {
  color: var(--danger);
}
.swatch {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-weight: 600;
}
.id {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  flex: none;
  border: 0;
  background: none;
  font-size: 18px;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  padding: 0 4px;
  border-radius: 4px;
}
.close:hover {
  background: var(--line);
  color: var(--text-strong);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-leave-active {
  position: absolute;
  width: 100%;
}
.toast-move {
  transition: transform 0.2s ease;
}
</style>
