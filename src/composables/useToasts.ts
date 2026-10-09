import { ref, watch, type Ref } from "vue";
import type { Detection } from "../types";
import { NEW_AGAIN_SECONDS, TOAST_MS } from "../config";
import type { MsgKey, Params } from "../i18n";
import { REPLAY_PREFIX } from "./useReplay";

type ToastKind = "info" | "alert";

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
const SEEN_KEY = "geomap.seenDrones"; // id -> last seen, ms; survives reloads

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
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    // unreadable: every drone counts as new once
  }
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
    // Replayed drones are past flights: no toasts, nothing in the alert log
    if (droneId.startsWith(REPLAY_PREFIX)) return;
    const key = nextKey++;
    const toast = { key, droneId, msg, params, kind };
    toasts.value = [...toasts.value, toast].slice(-MAX_TOASTS);
    alerts.value = [{ ...toast, time: Date.now() }, ...alerts.value].slice(
      0,
      MAX_ALERTS,
    );
    setTimeout(() => dismiss(key), TOAST_MS);
  }

  // A drone ID is new unless it was seen in the last NEW_AGAIN_SECONDS, reloads included
  watch(drones, (list) => {
    const now = Date.now();
    for (const d of list) {
      if (!(now - (seen[d.basic_id] ?? 0) <= NEW_AGAIN_SECONDS * 1000))
        push(d.basic_id, "msg.newDrone");
      seen[d.basic_id] = now;
    }
    for (const id in seen) if (now - seen[id] > NEW_AGAIN_SECONDS * 1000) delete seen[id];
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      // not kept across reloads; still no repeats in this session
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
