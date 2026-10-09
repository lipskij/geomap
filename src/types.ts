// Mirrors WiFi-RemoteID /api/detections entries
export interface Detection {
  basic_id: string;
  track_id?: string; // live feed: one per flight; a new flight of the same drone gets a new one
  rssi: number | null; // null: the receiver reported no signal strength
  drone_lat: number;
  drone_long: number;
  drone_altitude: number;
  drone_speed: number; // horizontal, m/s
  pilot_lat: number;
  pilot_long: number;
  last_update: number; // unix seconds
  sensors?: { node: string; rssi: number | null }[]; // live feed: scanner nodes hearing it
  visual?: boolean; // live feed: a camera saw it
  audio?: boolean; // live feed: a microphone heard it
}

// Map path point: lat, lng, time in ms
export type PathPoint = [number, number, number];

// Keyed by basic_id
export type Detections = Record<string, Detection>;
