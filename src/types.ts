// Mirrors WiFi-RemoteID /api/detections entries
export interface Detection {
  basic_id: string;
  rssi: number | null; // null: the receiver reported no signal strength
  drone_lat: number;
  drone_long: number;
  drone_altitude: number;
  drone_speed: number; // horizontal, m/s
  pilot_lat: number;
  pilot_long: number;
  last_update: number; // unix seconds
}

// Map path point: lat, lng, time in ms
export type PathPoint = [number, number, number];

// Keyed by basic_id
export type Detections = Record<string, Detection>;
