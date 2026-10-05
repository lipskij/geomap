# GeoMap

Live map of object positions from Remote ID detections, built with Vue 3, TypeScript and Leaflet.

**Live demo:** [lipskij.github.io/geomap](https://lipskij.github.io/geomap/)

## Features

- Polls detections every second and moves existing markers in place (no redraw flicker)
- Object and pilot markers with flight paths (solid for objects, dashed for pilot)
- Distinct color per object
- Expandable object list: click to focus, follow mode, per-object track export (GPX, KML, CSV)
- Popup with ID, RSSI, altitude and speed; copyable ID and coordinates
- New object alerts
- Fades objects after 10 s without updates, removes them after 60 s
- Map, satellite map layers
- Replay recorded tracks (CSV, GPX, KML) with play/pause, seek and speed control

## Requirements

Node.js 20.19+ or 22.12+

## Run

```bash
npm install
npm run dev
```

## Data format

`GET /api/...` returns an object keyed by `basic_id`:

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

Mock data is on by default. To read from a real `/api/detections` on the same origin:

```bash
VITE_USE_MOCK=false npm run build
```

## Drone zones (local only)

When running `npm run dev`, the app loads Lithuanian UAS geographical zones from the ANS UTM map (`utm.ans.lt`) through the Vite dev server and:

- draws them as a "Drone zones" layer (red: prohibited, amber: authorisation required, grey: information)
- checks each object: inside a zone horizontally and between the zone's lower and upper limit
- flags objects above 120 m
- alerts when an object enters a prohibited zone or goes above 120 m

Only zones active at the current time are used; zones reload every 5 minutes. Altitude is treated as height above ground, since all zone limits are AGL.

Zones are not loaded in production builds (GitHub Pages).

## Project structure

```
src/
  api.ts                          # fetchDetections(): mock or real API
  types.ts                        # Detection types
  config.ts                       # polling, fade and removal timings
  colors.ts                       # per-object colors
  export.ts                       # GPX / KML / CSV export
  mock/detections.ts              # simulated objects
  composables/useDetections.ts    # 1 s polling
  composables/useTrackHistory.ts  # track history for export
  composables/useToasts.ts        # new object and zone alerts
  composables/useReplay.ts        # replay playback
  replay/parse.ts                 # CSV / GPX / KML track parsing
  geo.ts                          # point-in-polygon helpers
  zones.ts                        # zone parsing, active times, zone/altitude check
  components/MapView.vue          # Leaflet map, markers, paths
  components/DroneList.vue        # object list
  components/ToastStack.vue       # alert messages
  components/ReplayPanel.vue      # replay controls
  App.vue
```

## Deploy

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
