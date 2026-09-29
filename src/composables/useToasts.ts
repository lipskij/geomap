import { ref, watch, type Ref } from "vue";
import type { Detection } from "../types";
import { TOAST_MS } from "../config";

export interface Toast {
  key: number;
  droneId: string;
  text: string;
}

const MAX_TOASTS = 5;

// Shows a message the first time each drone ID appears in this session
export function useNewDroneToasts(drones: Ref<Detection[]>) {
  const toasts = ref<Toast[]>([]);
  const seen = new Set<string>();
  let nextKey = 1;

  function dismiss(key: number) {
    toasts.value = toasts.value.filter((t) => t.key !== key);
  }

  watch(drones, (list) => {
    for (const d of list) {
      if (seen.has(d.basic_id)) continue;
      seen.add(d.basic_id);
      const key = nextKey++;
      toasts.value = [
        ...toasts.value,
        { key, droneId: d.basic_id, text: "New drone detected" },
      ].slice(-MAX_TOASTS);
      setTimeout(() => dismiss(key), TOAST_MS);
    }
  });

  return { toasts, dismiss };
}
