import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The worker's settings live in the repo root's `.env`; read its port from the same place.
  const { COURTYARD_PORT } = loadEnv(mode, "../..", "COURTYARD_");

  return {
    // The worker serves Fabrication under /fabrication, beside Courtyard on the same origin (#698).
    base: "/fabrication/",
    plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
    // `@/` is Fabrication's src folder, so imports read the same from any depth.
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    // The 3D view's file is `three` (#698), about 560 KB, loaded only by a Build's page.
    build: { chunkSizeWarningLimit: 600 },
    server: {
      // Beside the web app's 5173, so both run with `pnpm dev`; the worker owns the API.
      port: 5174,
      proxy: { "/api": `http://localhost:${COURTYARD_PORT || "8787"}` },
    },
  };
});
