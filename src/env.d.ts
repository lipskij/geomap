/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_LIVE_URL?: string;
  readonly VITE_LIVE_TOKEN?: string; // put in .env.local (gitignored), never commit
}
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
