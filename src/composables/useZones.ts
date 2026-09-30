import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { parseZones, type Zone } from "../zones";
import { ZONES_ENABLED, ZONES_REFRESH_MS, ZONES_URL } from "../config";

export function useZones() {
  const zones = shallowRef<Zone[]>([]);
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function load() {
    try {
      const res = await fetch(ZONES_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      zones.value = parseZones(await res.json());
      error.value = null;
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  onMounted(() => {
    if (!ZONES_ENABLED) return;
    load();
    timer = setInterval(load, ZONES_REFRESH_MS);
  });
  onBeforeUnmount(() => clearInterval(timer));

  return { zones, error };
}
