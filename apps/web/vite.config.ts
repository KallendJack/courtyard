import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * KaTeX's styles name each font three ways (woff2, woff, ttf). Every browser Courtyard runs in
 * reads woff2, so only those are built, and the service worker keeps a third of the files.
 */
const katexWoff2Only = (): Plugin => ({
  name: "courtyard-katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]katex[\\/].*\.css$/.test(id)) return;
    return code.replace(
      /,url\([^)]+\.woff\) format\("woff"\),url\([^)]+\.ttf\) format\("truetype"\)/g,
      "",
    );
  },
});

export default defineConfig(({ mode }) => {
  // The worker's settings live in the repo root's `.env`; read its port from the same place.
  const { COURTYARD_PORT } = loadEnv(mode, "../..", "COURTYARD_");

  return {
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      katexWoff2Only(),
    ],
    // `@/` is the web app's src folder, so imports read the same from any depth.
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: {
      // The build manifest lets finish-build.mjs measure the first load and list the app's files.
      manifest: true,
      rolldownOptions: {
        output: {
          // Everything the first load needs stays in one file. Otherwise a lazily loaded module
          // that is itself loaded by lazy code (a chart, loaded by the answer renderer) splits
          // what it shares with the first load, such as React and Zod, into files of their own,
          // which costs the first load bytes.
          codeSplitting: { groups: [{ name: "first-load", tags: ["$initial"] }] },
        },
      },
    },
    server: {
      // The worker owns the API; in development Vite serves the page and forwards `/api` to it.
      proxy: { "/api": `http://localhost:${COURTYARD_PORT || "8787"}` },
    },
  };
});
