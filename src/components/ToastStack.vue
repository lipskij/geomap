<script setup lang="ts">
import type { Toast } from "../composables/useToasts";
import { colorFor } from "../colors";

defineProps<{ toasts: Toast[] }>();
const emit = defineEmits<{
  select: [droneId: string];
  dismiss: [key: number];
}>();
</script>

<template>
  <TransitionGroup tag="div" name="toast" class="stack">
    <div
      v-for="t in toasts"
      :key="t.key"
      class="toast"
      @click="emit('select', t.droneId)"
    >
      <span class="swatch" :style="{ background: colorFor(t.droneId) }" />
      <span class="body">
        <span class="title">{{ t.text }}</span>
        <span class="id">{{ t.droneId }}</span>
      </span>
      <button
        class="close"
        title="Dismiss"
        @click.stop="emit('dismiss', t.key)"
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
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.3);
  font:
    13px/1.3 system-ui,
    sans-serif;
  color: #1f2937;
  cursor: pointer;
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
  color: #6b7280;
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
  color: #6b7280;
  cursor: pointer;
  padding: 0 2px;
}
.close:hover {
  color: #111827;
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
