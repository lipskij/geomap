import { watch } from 'vue'
import type { Detections } from './types'
import { getMockDetections } from './mock/detections'
import type { Bearing } from './acoustic'
import { getMockBearings } from './mock/acoustic'
import { liveBearings, liveDetections, setLive } from './live'
import { stored } from './stored'

// Where drones come from: built-in mock data or the backend live feed. Switchable in the
// app; the choice is remembered per browser
type DataSource = 'mock' | 'live'
export const source = stored<DataSource>('geomap.source', 'mock', ['mock', 'live'])
watch(source, (s) => setLive(s === 'live'), { immediate: true })

export async function fetchDetections(): Promise<Detections> {
  return source.value === 'mock' ? getMockDetections() : liveDetections()
}

export async function fetchBearings(): Promise<Bearing[]> {
  return source.value === 'mock' ? getMockBearings() : liveBearings()
}
