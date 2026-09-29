import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "./", // relative paths so it works under https://<user>.github.io/<repo>/
  plugins: [vue()],
});
