import { ref, watch, type Ref } from "vue";

// UI state remembered per browser (collapsed sections, language, data source), across
// tabs and reloads. Strings: a saved value not in `allowed` falls back to `initial`
export function stored(key: string, initial: boolean): Ref<boolean>;
export function stored<T extends string>(key: string, initial: T, allowed: readonly T[]): Ref<T>;
export function stored(key: string, initial: string | boolean, allowed?: readonly string[]) {
  let start = initial;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null && typeof initial === "boolean") start = saved === "1";
    else if (saved !== null && allowed?.includes(saved)) start = saved;
  } catch {
    // storage blocked: use the default
  }
  const r = ref(start);
  watch(r, (v) => {
    try {
      localStorage.setItem(key, typeof v === "boolean" ? (v ? "1" : "0") : v);
    } catch {
      // not remembered; still changes
    }
  });
  return r;
}
