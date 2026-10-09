import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // .env.local too, incl. VITE_LIVE_TOKEN
  return {
    base: "./", // relative paths so it works under https://<user>.github.io/<repo>
    plugins: [vue()],
    server: {
      proxy: {
        // Dev only: API_TARGET=http://localhost:8000 forwards /api/* to the backend
        ...(process.env.API_TARGET && {
          "/api": { target: process.env.API_TARGET, changeOrigin: true },
        }),
        // Dev only: forwards /ans-api/* to the ANS UTM map API (avoids CORS; not used in production builds)
        "/ans-api": {
          target: process.env.ANS_TARGET ?? "https://utm.ans.lt",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ans-api/, "/avm"),
        },
        // Dev only: forwards /oracle/* to the concentrator REST API with the key added here.
        // Works around its missing CORS and its media ?token= returning 401; production
        // needs those fixed on the backend (or a backend of our own) instead
        "/oracle": {
          target: "https://oracle.danius.cfd:8443",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/oracle/, ""),
          headers: env.VITE_LIVE_TOKEN ? { Authorization: `Bearer ${env.VITE_LIVE_TOKEN}` } : {},
        },
      },
    },
  };
});
