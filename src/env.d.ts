/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVE_URL?: string;
  readonly VITE_LIVE_TOKEN?: string; // put in .env.local (gitignored), never commit
  readonly VITE_PLANS_BACKEND?: string;
}
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
// Since the last commit:

// - Live data: the app connects to the backend's live feed. A Mock/Live switch is in the top bar, with Mock as the default. If the feed fails, the app shows one message: "Live data not available, something went wrong".
// - Detection panel: shows the drone without Remote ID, which cameras see it, and an OK / NOT OK verdict for whether it's worth deploying interceptors.
// - Acoustic triangulation: a mock mesh of 9 microphones in a field, with one drone flying through on repeat. Bearings, the drone's estimated position and its heading are drawn on the map. Nothing is shown while only one sensor hears it.
// - Monitor:
//   - The drone without Remote ID appears in the list; clicking it opens Detection.
//   - A Sensors row in the drone details lists the stations that detected it, with camera images; clicking an image opens it large, and it refreshes when a new one arrives.
//   - Map layers have a checkbox to show or hide sensors.
// - Planner:
//   - Each sensor's range depends on background noise (rural, suburban or urban), detected from the map automatically.
//   - Mast height increases range.
//   - The selected sensor is highlighted, and the sensor rows have a cleaner layout.
// - Fixes:
//   - A drone's trail no longer draws a line when its position jumps a long way.
//   - A repeat of the same flight no longer re-triggers "new drone detected"; a new flight still does, even after a reload.

// Known limits:
// - Camera images work only in dev, because the backend has no CORS. Image links with the key in the URL also don't work yet.
// - The camera position is faked until the backend sends real ones.
