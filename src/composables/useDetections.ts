import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { fetchDetections } from '../api'
import type { Detections } from '../types'

export function useDetections(intervalMs = 1000) {
  const detections = shallowRef<Detections>({})
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function tick() {
    try {
      detections.value = await fetchDetections()
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }

  onMounted(tick)
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })

  return { detections, error }
}
