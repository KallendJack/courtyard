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

const MERMAID_FILE = /[\\/]mermaid[\\/]dist[\\/](chunks[\\/])?mermaid\.esm\.min/;
const NO_ELK = "\0courtyard-no-elk";

/**
 * Mermaid as Courtyard draws diagrams with it (rich-blocks/mermaid.tsx):
 * - From its prebuilt files, its own dependencies bundled in. Built from its source, the CommonJS
 *   among those dependencies need the bundler's helpers for it, which every page shares, and the
 *   bundler splits those helpers into a file of their own on the first load.
 * - Without the `require` that esbuild's shim in those files names, which no diagram calls in a
 *   browser, for the same reason: read from `globalThis`, it needs no helper.
 * - Without its ELK layout (500 KB gzipped), which no diagram can ask for: they're laid out by
 *   dagre. It's left out of the build, so the service worker never fetches it either.
 */
const mermaidAsDrawn = (): Plugin => ({
  name: "courtyard-mermaid-as-drawn",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "mermaid") return this.resolve("mermaid/dist/mermaid.esm.min.mjs", importer);
    if (importer !== undefined && MERMAID_FILE.test(importer) && /[\\/]elk-\w+\.mjs$/.test(source))
      return NO_ELK;
  },
  load(id) {
    if (id === NO_ELK)
      return 'export const render = () => { throw new Error("Diagrams are laid out by dagre"); };';
  },
  transform(code, id) {
    if (!MERMAID_FILE.test(id)) return;
    return code.replace(/(?<![.\w$])require(?![\w$])/g, "globalThis.require");
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
      mermaidAsDrawn(),
    ],
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
