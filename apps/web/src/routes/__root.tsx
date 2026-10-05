import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-dvh bg-white text-neutral-900">
      <Outlet />
    </div>
  ),
});
