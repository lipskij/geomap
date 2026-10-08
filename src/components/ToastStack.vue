<script setup lang="ts">
import Icon from "./Icon.vue";
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
      <span class="disc" :style="{ background: colorFor(toast.droneId) }">
        <Icon :name="toast.kind === 'alert' ? 'warning' : 'drone'" />
      </span>
      <span class="body">
        <span class="title">{{ t(toast.msg, toast.params) }}</span>
        <span class="id">{{ toast.droneId }}</span>
      </span>
      <button
        class="close"
        :title="t('toast.dismiss')"
        @click.stop="emit('dismiss', toast.key)"
      >
        <Icon name="close" />
      </button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
/* Top-left; the zoom buttons moved to the bottom right, so this corner is free */
.stack {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 290px;
  max-width: calc(100vw - 20px);
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 12px;
  background: var(--panel);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  font: var(--font-size) var(--font);
  color: var(--text);
  cursor: pointer;
}
.toast.alert {
  box-shadow: var(--shadow), inset 4px 0 0 var(--danger);
}
.toast.alert .title {
  color: var(--danger);
}
.disc {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  font-size: 17px;
}
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-weight: 600;
  color: var(--text-strong);
}
.id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: none;
  font-size: 16px;
  color: var(--muted);
  cursor: pointer;
}
.close:hover {
  background: var(--hover);
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
