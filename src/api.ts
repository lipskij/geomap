import type { Detections } from './types'
import { getMockDetections } from './mock/detections'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export async function fetchDetections(): Promise<Detections> {
  if (USE_MOCK) return getMockDetections()
  const res = await fetch('/api/detections')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
