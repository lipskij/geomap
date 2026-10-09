import type { Detection, Detections } from './types'
import { getMockDetections } from './mock/detections'
import type { Bearing } from './acoustic'
import { getMockBearings } from './mock/acoustic'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
// Backend origin, e.g. https://api.example.com; empty = same origin as the app
export const API_URL = import.meta.env.VITE_API_URL ?? ''

// One decoded Remote ID frame as the receiver sends it (ESP32 id_open JSON)
interface RawDetection {
  'uav id': string
  rssi: number
  'uav latitude': number
  'uav longitude': number
  'uav altitude': number
  'uav speed': number
  'base latitude': number
  'base longitude': number
  'unix time': number // drone's own clock: often wrong or unset, so not used
  received?: number // unix seconds when the receiver got the frame (added by the backend)
}

function toDetection(r: RawDetection): Detection {
  return {
    basic_id: r['uav id'],
    rssi: r.rssi,
    drone_lat: r['uav latitude'],
    drone_long: r['uav longitude'],
    drone_altitude: r['uav altitude'],
    drone_speed: r['uav speed'],
    pilot_lat: r['base latitude'],
    pilot_long: r['base longitude'],
    // ponytail: falls back to browser time until the backend sends `received`;
    // then a drone the backend keeps returning never goes stale here
    last_update: r.received ?? Date.now() / 1000,
  }
}

export async function fetchDetections(): Promise<Detections> {
  if (USE_MOCK) return getMockDetections()
  const res = await fetch(`${API_URL}/api/detections`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body: RawDetection | RawDetection[] = await res.json()
  const raws = Array.isArray(body) ? body : [body]
  return Object.fromEntries(raws.map(r => [r['uav id'], toDetection(r)]))
}

// ponytail: no acoustic feed exists yet, so only the mock produces bearings;
// fetch from the backend here once the arrays report somewhere
export async function fetchBearings(): Promise<Bearing[]> {
  return USE_MOCK ? getMockBearings() : []
}
