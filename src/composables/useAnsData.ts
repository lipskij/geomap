import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

// Loads and periodically reloads a GeoJSON endpoint (ANS UTM data, dev only)
export function useAnsData<T>(
  url: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse: (geojson: any) => T[],
  refreshMs: number,
  enabled: boolean,
) {
  const items = shallowRef<T[]>([]);
  const error = ref<string | null>(null);
  const loaded = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  async function load() {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items.value = parse(await res.json());
      loaded.value = true;
      error.value = null;
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  onMounted(() => {
    if (!enabled) return;
    load();
    timer = setInterval(load, refreshMs);
  });
  onBeforeUnmount(() => clearInterval(timer));

  return { items, error, loaded };
}
