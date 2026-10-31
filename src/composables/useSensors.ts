import type { IconName } from "../icons";

export type SensorType = "rid" | "audio" | "video";

export interface Sensor {
  id: number;
  type: SensorType;
  lat: number;
  lng: number;
  name?: string; // backend node id (live feed nodes)
  offline?: boolean; // backend node not reporting
  camera?: boolean; // backend node streams a live camera (watchCamera)
}

// ponytail: rough default detection ranges per type; per-sensor values come later
// with the real sensor list
export const SENSOR_TYPES: Record<SensorType, { icon: IconName; color: string; range: number }> = {
  // ESP32-S3 + 12 dBi omni (≈6–8 dBi real) + 200 mm pigtail, drone ≈16 dBm EIRP at 30 m AGL:
  // ≈1.5 km in the open, 0.5–1 km suburban. Check against RSSI from real detections
  rid: { icon: "sensors", color: "#1f7ae0", range: 1500 },
  audio: { icon: "mic", color: "#8e44ad", range: 300 },
  video: { icon: "videocam", color: "#0f9d8a", range: 800 },
};

export const rangeOf = (s: Sensor) => SENSOR_TYPES[s.type].range;
