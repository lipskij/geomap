import type { Detection, Detections } from "../types";

interface MockDrone {
  basic_id: string;
  pilot: [number, number];
  radius: number; // degrees
  speed: number; // rad/s
  phase: number;
  stopAfter?: number; // seconds; simulates a drone going silent
  alt?: [number, number]; // base, amplitude (m above ground)
}

const drones: MockDrone[] = [
  {
    basic_id: "1581F5FJD239C00A1B2C",
    pilot: [54.6872, 25.2797],
    radius: 0.004,
    speed: 0.03,
    phase: 0,
  },
  {
    basic_id: "1581F4XFC238E00D3E4F",
    pilot: [54.6935, 25.265],
    radius: 0.003,
    speed: -0.05,
    phase: 2,
    alt: [110, 25],
  }, // climbs above 120 m
  {
    basic_id: "1668B2PQ5A00000G5H6I",
    pilot: [54.681, 25.29],
    radius: 0.002,
    speed: 0.08,
    phase: 4,
    stopAfter: 20,
  },
  {
    basic_id: "1581F6ZZK241A00P7Q8R",
    pilot: [54.6781, 25.264],
    radius: 0.003,
    speed: 0.06,
    phase: 3,
    alt: [70, 5],
  }, // loop crosses prohibited zone T4
];

const M_PER_DEG_LAT = 111_320;

const start = Date.now() / 1000;
const lastSeen: Record<string, number> = {};

// Demo drone flying inside an approved flight plan area (set from App in dev, see setDemoArea)
export interface DemoArea {
  lat: number;
  lng: number;
  radius: number; // degrees latitude
  alt: number; // m above ground
}
const DEMO_ID = "1581F7PLANDEMO000001";
let demo: DemoArea | null = null;

export function setDemoArea(area: DemoArea | null) {
  demo = area;
}

export function getMockDetections(): Detections {
  const now = Date.now() / 1000;
  const t = now - start;
  const out: Detections = {};

  for (const d of drones) {
    const active = d.stopAfter === undefined || t < d.stopAfter;
    if (active) lastSeen[d.basic_id] = now;
    const tt = active ? t : d.stopAfter!;
    const a = d.phase + d.speed * tt;
    // Direction of travel along the circle (north = cos a, east = -sin a, scaled by rotation sign)
    const heading =
      (Math.atan2(-Math.sin(a) * d.speed, Math.cos(a) * d.speed) * 180) /
      Math.PI;
    const det: Detection = {
      basic_id: d.basic_id,
      rssi: -50 - Math.round(Math.random() * 30),
      drone_lat: d.pilot[0] + d.radius * Math.sin(a),
      drone_long: d.pilot[1] + d.radius * 1.7 * Math.cos(a), // 1.7 ≈ lng stretch at 54°N
      drone_altitude: Math.round(
        (d.alt?.[0] ?? 80) + (d.alt?.[1] ?? 20) * Math.sin(a * 2),
      ),
      drone_speed: active ? d.radius * M_PER_DEG_LAT * Math.abs(d.speed) : 0,
      drone_heading: Math.round((heading + 360) % 360),
      pilot_lat: d.pilot[0],
      pilot_long: d.pilot[1],
      last_update: lastSeen[d.basic_id],
    };
    out[d.basic_id] = det;
  }
  if (demo) {
    const a = 0.1 * t;
    out[DEMO_ID] = {
      basic_id: DEMO_ID,
      rssi: -55 - Math.round(Math.random() * 20),
      drone_lat: demo.lat + demo.radius * Math.sin(a),
      drone_long: demo.lng + demo.radius * 1.7 * Math.cos(a),
      drone_altitude: demo.alt,
      drone_speed: demo.radius * M_PER_DEG_LAT * 0.1,
      drone_heading: Math.round(
        ((Math.atan2(-Math.sin(a), Math.cos(a)) * 180) / Math.PI + 360) % 360,
      ),
      pilot_lat: demo.lat,
      pilot_long: demo.lng,
      last_update: now,
    };
  }

  return out;
}
