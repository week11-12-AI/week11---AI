import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: {
    jsxFactory: "h",
  },
  build: {
    rollupOptions: {
      input: {
        phase1: fileURLToPath(new URL("./index.html", import.meta.url)),
        phase2: fileURLToPath(new URL("./phase2.html", import.meta.url)),
      },
    },
  },
});
