import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The worker's settings live in the repo root's `.env`; read its port from the same place.
  const { COURTYARD_PORT } = loadEnv(mode, "../..", "COURTYARD_");

  return {
    plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
    // `@/` is the web app's src folder, so imports read the same from any depth.
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    // The build manifest lets finish-build.mjs measure the first load and list the app's files.
    build: { manifest: true },
    server: {
      // The worker owns the API; in development Vite serves the page and forwards `/api` to it.
      proxy: { "/api": `http://localhost:${COURTYARD_PORT || "8787"}` },
    },
  };
});
