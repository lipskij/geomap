export const POLL_MS = 1000;
export const FADE_SECONDS = 10; // grey out drones without updates
export const STALE_SECONDS = 60; // remove drones without updates
export const TOAST_MS = 6000; // new-drone message lifetime

// Drone zones (ANS UTM). Dev only, via the Vite proxy; disabled in production builds.
export const ZONES_ENABLED = import.meta.env.DEV;
export const ZONES_URL = "/ans-api/utm/uas.geojson";
export const ZONES_REFRESH_MS = 5 * 60_000; // temporary zones / NOTAMs change during the day
export const MAX_ALT_M = 120; // EU open category limit, m above ground
export const PLANS_URL = "/ans-api/utm/operationplans.geojson";
export const PLANS_REFRESH_MS = 60_000; // flight plans change often
