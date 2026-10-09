import { ref, watch } from 'vue'
import type { Detections } from './types'
import { getMockDetections } from './mock/detections'
import type { Bearing } from './acoustic'
import { getMockBearings } from './mock/acoustic'
import { liveBearings, liveDetections, setLive } from './live'

// Backend origin for REST (sensor plans), e.g. https://api.example.com; empty = same origin
export const API_URL = import.meta.env.VITE_API_URL ?? ''

// Where drones come from: built-in mock data or the backend live feed. Switchable in the
// app; the choice is remembered per browser
export type DataSource = 'mock' | 'live'
const SOURCE_KEY = 'geomap.source'
function loadSource(): DataSource {
  try {
    const saved = localStorage.getItem(SOURCE_KEY)
    if (saved === 'mock' || saved === 'live') return saved
  } catch {
    // storage blocked: fall back to the build default
  }
  return import.meta.env.VITE_USE_MOCK === 'false' ? 'live' : 'mock'
}
export const source = ref<DataSource>(loadSource())
watch(
  source,
  (s) => {
    try {
      localStorage.setItem(SOURCE_KEY, s)
    } catch {
      // not remembered across reloads; still switches
    }
    setLive(s === 'live')
  },
  { immediate: true },
)

export async function fetchDetections(): Promise<Detections> {
  return source.value === 'mock' ? getMockDetections() : liveDetections()
}

export async function fetchBearings(): Promise<Bearing[]> {
  return source.value === 'mock' ? getMockBearings() : liveBearings()
}
