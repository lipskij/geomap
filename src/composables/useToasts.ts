import { ref, watch, type Ref } from "vue";
import type { Detection } from "../types";
import { TOAST_MS } from "../config";
import type { MsgKey, Params } from "../i18n";

export type ToastKind = "info" | "alert";

export interface Toast {
  key: number;
  droneId: string;
  msg: MsgKey; // translated when shown, so the log follows the language setting
  params?: Params;
  kind: ToastKind;
}

export interface Alert extends Toast {
  time: number; // ms since epoch
}

const MAX_TOASTS = 5;
const MAX_ALERTS = 500;
const ALERTS_KEY = "geomap.alerts";

function loadAlerts(): Alert[] {
  try {
    const saved: Alert[] = JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "[]");
    return saved.filter((a) => a.msg); // drop entries saved before translation
  } catch {
    return [];
  }
}

export function useToasts(drones: Ref<Detection[]>) {
  const toasts = ref<Toast[]>([]);
  // Every toast is also kept in the alert log (newest first), saved across reloads
  // POC storage (localStorage); move alerts + zone checks to the backend DB later
  const alerts = ref<Alert[]>(loadAlerts());
  const seen = new Set<string>();
  let nextKey = Math.max(0, ...alerts.value.map((a) => a.key)) + 1;

  watch(alerts, (list) => {
    try {
      localStorage.setItem(ALERTS_KEY, JSON.stringify(list));
    } catch {
      // storage full or blocked: log stays in memory only
    }
  });

  function dismiss(key: number) {
    toasts.value = toasts.value.filter((t) => t.key !== key);
  }

  function push(
    droneId: string,
    msg: MsgKey,
    params?: Params,
    kind: ToastKind = "info",
  ) {
    const key = nextKey++;
    const toast = { key, droneId, msg, params, kind };
    toasts.value = [...toasts.value, toast].slice(-MAX_TOASTS);
    alerts.value = [{ ...toast, time: Date.now() }, ...alerts.value].slice(
      0,
      MAX_ALERTS,
    );
    setTimeout(() => dismiss(key), TOAST_MS);
  }

  // First time each drone ID appears in this session
  watch(drones, (list) => {
    for (const d of list) {
      if (seen.has(d.basic_id)) continue;
      seen.add(d.basic_id);
      push(d.basic_id, "msg.newDrone");
    }
  });

  return {
    toasts,
    dismiss,
    push,
    alerts,
    clearAlerts: () => (alerts.value = []),
  };
}
