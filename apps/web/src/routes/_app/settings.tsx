import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Page, PageTitle } from "@/components/layout/page";
import { BackupStatus } from "../../features/settings/backup-status.tsx";
import { LogOutOthers } from "../../features/settings/log-out-others.tsx";
import { OwnerContextPanel } from "../../features/settings/owner-context-panel.tsx";

// Loaded once the page shows: the page never waits for them.
const SignIns = lazy(() => import("../../features/sign-ins/sign-ins.tsx"));
const Notifications = lazy(() => import("../../features/notifications/notifications-card.tsx"));

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/settings")({
  // The loader stays in the first load, so its schemas load with the page.
  loader: async () => ({
    ownerContext: await import("../../api/worker-calls.ts").then((calls) =>
      calls.loadOwnerContext(),
    ),
  }),
  component: Settings,
});

/**
 * Settings (#102): everything that used to be on Home besides the workspaces, as it was there.
 * The owner context, the context backup when it needs the owner (`#backup`, where Home's Fix it
 * goes), the sign-in offers and Connections (`#connections`) with this device's notifications,
 * Fresh start, and logging out every other device. On a desktop it's in the sidebar; on a touch
 * screen, in the frame's Settings sheet.
 */
function Settings() {
  const workspaces = loggedIn.useLoaderData();
  const { ownerContext } = Route.useLoaderData();
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];

  return (
    <Page header={<PageTitle>Settings</PageTitle>}>
      <OwnerContextPanel
        result={ownerContext}
        canGetToKnow={list.some((workspace) => workspace.mode === "planning")}
      />
      <div id="backup">
        <BackupStatus />
      </div>
      <Suspense fallback={null}>
        <SignIns part="boxes" />
      </Suspense>
      <Suspense fallback={null}>
        <SignIns
          part="list"
          beside={
            <Suspense fallback={null}>
              <Notifications />
            </Suspense>
          }
        />
      </Suspense>
      <div className="mt-7 flex justify-end">
        <Link
          to="/fresh-start"
          className="text-meta font-medium text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
        >
          Fresh start…
        </Link>
      </div>
      <LogOutOthers />
    </Page>
  );
}
