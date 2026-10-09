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
