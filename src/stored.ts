import { ref, watch, type Ref } from "vue";

// Boolean UI state remembered per browser (collapsed sections), across tabs and reloads
export function stored(key: string, initial: boolean): Ref<boolean> {
  let start = initial;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) start = saved === "1";
  } catch {
    // storage blocked: use the default
  }
  const r = ref(start);
  watch(r, (v) => {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // not remembered; still toggles
    }
  });
  return r;
}
