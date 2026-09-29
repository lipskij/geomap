# GeoMap

Live map of drone positions from Remote ID detections, built with Vue 3, TypeScript and Leaflet (OpenStreetMap tiles).

The data model follows [WiFi-RemoteID](https://github.com/lukeswitz/WiFi-RemoteID)'s `/api/detections` format. Mock data is used by default.

## Features

- Polls detections every second and moves existing markers in place (no redraw flicker)
- Drone and pilot markers with flight paths (solid for drone, dashed for pilot)
- Distinct color per drone
- Popup with ID, RSSI, altitude and speed
- Removes drones that have not updated for 60 s
- Skips `0,0` positions (no GPS fix)

## Requirements

Node.js 20.19+ or 22.12+

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Data format

`GET /api/detections` returns an object keyed by `basic_id`:

```json
{
  "1581F5FJD239C00A1B2C": {
    "basic_id": "1581F5FJD239C00A1B2C",
    "rssi": -62,
    "drone_lat": 54.6875,
    "drone_long": 25.2864,
    "drone_altitude": 84,
    "drone_speed": 13.4,
    "pilot_lat": 54.6872,
    "pilot_long": 25.2797,
    "last_update": 1790000000
  }
}
```

| Field            | Unit               |
| ---------------- | ------------------ |
| `drone_altitude` | m                  |
| `drone_speed`    | m/s, horizontal    |
| `last_update`    | Unix time, seconds |

## Real data

Mock data is on by default. To call a real `/api/detections` on the same origin:

```bash
VITE_USE_MOCK=false npm run build
```

## Project structure

```
src/
  api.ts                      # fetchDetections(): mock or real API
  types.ts                    # Detection types
  mock/detections.ts          # simulated drones
  composables/useDetections.ts# 1 s polling
  components/MapView.vue      # Leaflet map, markers, paths
  App.vue
```
