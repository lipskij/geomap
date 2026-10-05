import { shallowRef, watch, type Ref, type WatchSource } from "vue";

// Re-filters `source` whenever `tick` changes, but only replaces the result when the
// subset actually changes (by key), so map layers aren't redrawn every poll.
export function useActiveSubset<T>(
  source: Ref<T[]>,
  tick: WatchSource,
  isActive: (item: T) => boolean,
  key: (item: T) => string,
) {
  const active = shallowRef<T[]>([]);
  let lastSource: T[] | null = null;
  watch([source, tick], () => {
    const next = source.value.filter(isActive);
    const keys = (list: T[]) => list.map(key).join("|");
    if (source.value !== lastSource || keys(next) !== keys(active.value))
      active.value = next;
    lastSource = source.value;
  });
  return active;
}
