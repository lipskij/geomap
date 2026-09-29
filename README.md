# GeoMap

Live map of objects positions from Remote ID detections, built with Vue 3, TypeScript and Leaflet (OpenStreetMap tiles).

## Features

- Polls detections every second and moves existing markers in place (no redraw flicker)
- Object and pilot markers with flight paths (solid for objects, dashed for pilot)
- Distinct color per objects
- Popup with ID, RSSI, altitude and speed
- Removes objects that have not updated for 60 s

## Requirements

Node.js 20.19+ or 22.12+

## Run

```bash
npm install
npm run dev
```

```json
{
  "1581F5FJD239C00A1B2C": {
    "basic_id": "1581F5FJD239C00A1B2C",
    "rssi": -62,
    "d_lat": 54.6875,
    "d_long": 25.2864,
    "d_altitude": 84,
    "d_speed": 13.4,
    "pilot_lat": 54.6872,
    "pilot_long": 25.2797,
    "last_update": 1790000000
  }
}
```

| Field         | Unit               |
| ------------- | ------------------ |
| `d_altitude`  | m                  |
| `d_speed`     | m/s, horizontal    |
| `last_update` | Unix time, seconds |

## Real data

Mock data is on by default.

```bash
VITE_USE_MOCK=false npm run build
```

## Project structure

```
src/
  api.ts                        # fetchDetections(): mock or real API
  types.ts                      # Detection types
  mock/detections.ts            # simulated objects
  composables/useDetections.ts  # 1 s polling
  components/MapView.vue        # Leaflet map, markers, paths
  App.vue
```
