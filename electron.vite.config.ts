import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { external: ["electron"], input: resolve("src/main/index.ts") } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron"],
        input: resolve("src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" }
      }
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    build: { rollupOptions: { input: resolve("src/renderer/index.html") } }
  }
});
