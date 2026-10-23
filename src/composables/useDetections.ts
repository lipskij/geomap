import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { fetchDetections } from '../api'
import { POLL_MS } from '../config'
import type { Detections } from '../types'

// Runs fn while the component is mounted: now, then POLL_MS after each run finishes
export function usePoll(fn: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  async function tick() {
    await fn()
    if (!stopped) timer = setTimeout(tick, POLL_MS)
  }
  onMounted(tick)
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })
}

export function useDetections() {
  const detections = shallowRef<Detections>({})
  const error = ref<string | null>(null)
  usePoll(async () => {
    try {
      detections.value = await fetchDetections()
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    }
  })
  return { detections, error }
}
