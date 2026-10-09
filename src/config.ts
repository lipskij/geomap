export const POLL_MS = 1000;
export const FADE_SECONDS = 10; // grey out drones without updates
export const STALE_SECONDS = 60; // remove drones without updates
export const TOAST_MS = 6000; // new-drone message lifetime
export const NEW_AGAIN_SECONDS = 600; // a flight (or mock drone) unseen this long is announced again
export const GAP_SECONDS = 5; // longer without data: path drawn dashed (signal gap)
export const JUMP_M = 5000; // farther between two fixes: not one flight (test data, bad fix), path not joined

// Drone zones (ANS UTM). Dev only, via the Vite proxy; disabled in production builds.
export const ZONES_ENABLED = import.meta.env.DEV;
export const ZONES_URL = "/ans-api/utm/uas.geojson";
export const ZONES_REFRESH_MS = 5 * 60_000; // temporary zones / NOTAMs change during the day
export const MAX_ALT_M = 120; // EU open category limit, m above ground
