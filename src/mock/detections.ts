import type { Detection, Detections } from '../types'

interface MockDrone {
  basic_id: string
  pilot: [number, number]
  radius: number // degrees
  speed: number // rad/s
  phase: number
  stopAfter?: number // seconds; simulates a drone going silent
}

const drones: MockDrone[] = [
  { basic_id: '1581F5FJD239C00A1B2C', pilot: [54.6872, 25.2797], radius: 0.004, speed: 0.03, phase: 0 },
  { basic_id: '1581F4XFC238E00D3E4F', pilot: [54.6935, 25.2650], radius: 0.003, speed: -0.05, phase: 2 },
  { basic_id: '1668B2PQ5A00000G5H6I', pilot: [54.6810, 25.2900], radius: 0.002, speed: 0.08, phase: 4, stopAfter: 20 },
]

const M_PER_DEG_LAT = 111_320

const start = Date.now() / 1000
const lastSeen: Record<string, number> = {}

export function getMockDetections(): Detections {
  const now = Date.now() / 1000
  const t = now - start
  const out: Detections = {}

  for (const d of drones) {
    const active = d.stopAfter === undefined || t < d.stopAfter
    if (active) lastSeen[d.basic_id] = now
    const tt = active ? t : d.stopAfter!
    const a = d.phase + d.speed * tt
    const det: Detection = {
      basic_id: d.basic_id,
      rssi: -50 - Math.round(Math.random() * 30),
      drone_lat: d.pilot[0] + d.radius * Math.sin(a),
      drone_long: d.pilot[1] + d.radius * 1.7 * Math.cos(a), // 1.7 ≈ lng stretch at 54°N
      drone_altitude: 80 + Math.round(20 * Math.sin(a * 2)),
      drone_speed: active ? d.radius * M_PER_DEG_LAT * Math.abs(d.speed) : 0,
      pilot_lat: d.pilot[0],
      pilot_long: d.pilot[1],
      last_update: lastSeen[d.basic_id],
    }
    out[d.basic_id] = det
  }
  return out
}
