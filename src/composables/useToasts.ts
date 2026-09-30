import { ref, watch, type Ref } from "vue";
import type { Detection } from "../types";
import { TOAST_MS } from "../config";

export type ToastKind = "info" | "alert";

export interface Toast {
  key: number;
  droneId: string;
  text: string;
  kind: ToastKind;
}

const MAX_TOASTS = 5;

export function useToasts(drones: Ref<Detection[]>) {
  const toasts = ref<Toast[]>([]);
  const seen = new Set<string>();
  let nextKey = 1;

  function dismiss(key: number) {
    toasts.value = toasts.value.filter((t) => t.key !== key);
  }

  function push(droneId: string, text: string, kind: ToastKind = "info") {
    const key = nextKey++;
    toasts.value = [...toasts.value, { key, droneId, text, kind }].slice(
      -MAX_TOASTS,
    );
    setTimeout(() => dismiss(key), TOAST_MS);
  }

  // First time each drone ID appears in this session
  watch(drones, (list) => {
    for (const d of list) {
      if (seen.has(d.basic_id)) continue;
      seen.add(d.basic_id);
      push(d.basic_id, "New drone detected");
    }
  });

  return { toasts, dismiss, push };
}
