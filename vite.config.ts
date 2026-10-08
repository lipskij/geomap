import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
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
    },
  },
});
