import type { Detection, Detections } from './types'
import { getMockDetections } from './mock/detections'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

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
  'unix time': number
}

export function toDetection(r: RawDetection): Detection {
  return {
    basic_id: r['uav id'],
    rssi: r.rssi,
    drone_lat: r['uav latitude'],
    drone_long: r['uav longitude'],
    drone_altitude: r['uav altitude'],
    drone_speed: r['uav speed'],
    pilot_lat: r['base latitude'],
    pilot_long: r['base longitude'],
    last_update: r['unix time'],
  }
}

export async function fetchDetections(): Promise<Detections> {
  if (USE_MOCK) return getMockDetections()
  const res = await fetch('/api/detections')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body: RawDetection | RawDetection[] = await res.json()
  const raws = Array.isArray(body) ? body : [body]
  return Object.fromEntries(raws.map(r => [r['uav id'], toDetection(r)]))
}
