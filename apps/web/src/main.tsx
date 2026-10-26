import { PAGE_SCROLL_SELECTOR } from "@courtyard/ui/layout/page-scroll.ts";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "./components/layout/problems.tsx";
import { routeTree } from "./routeTree.gen.ts";
import "./lib/app.css";

/** The address last drawn, so the scroll moves only for a move to another page. */
let drawn: string | undefined;

const router = createRouter({
  routeTree,
  defaultErrorComponent: AppError,
  // A page opened before shows its last data at once, and its loader asks again behind it (#808),
  // for as long as the tab is open, as every block's kept answers are (#269). One preloaded by a
  // touched tile asks again too, or it would show for 30 s what was true before a change.
  defaultGcTime: Number.POSITIVE_INFINITY,
  defaultPreloadGcTime: Number.POSITIVE_INFINITY,
  defaultPreloadStaleTime: 0,
  // The router scrolls to the top each time it draws, a page reloading its data included (a
  // session's new title, the worker coming back): only a move to another page should, or back to
  // where that page was (#168).
  scrollRestoration: ({ location }) => {
    const moved = location.href !== drawn;
    drawn = location.href;
    return moved;
  },
  // A page scrolls its own middle, not the window (#266, #339): that goes to the top of a new page.
  scrollToTopSelectors: [PAGE_SCROLL_SELECTOR],
});

// An `interface`, not a `type`: TanStack Router registers the router through declaration merging.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("index.html has no #app element");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Installed on the home screen, the app opens from these kept files (only in a build: during
// development Vite serves fresh files and nothing should be kept).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}
