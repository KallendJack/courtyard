import type { OwnerContextDetail } from "@courtyard/contract";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { OfflineLine } from "@/components/layout/offline";
import { Page, PageTitle } from "@/components/layout/page";
import type { FromWorker } from "../../api/worker.ts";
import { BackupStatus } from "../../features/settings/backup-status.tsx";
import { LogOutOthers } from "../../features/settings/log-out-others.tsx";
import { OwnerContextPanel } from "../../features/settings/owner-context-panel.tsx";

// Loaded once the page shows: the page never waits for them.
const SignIns = lazy(() => import("../../features/sign-ins/sign-ins.tsx"));
const Notifications = lazy(() => import("../../features/notifications/notifications-card.tsx"));
const ReadOffline = lazy(() => import("../../features/offline-copy/offline-copy-card.tsx"));

const loggedIn = getRouteApi("/_app");

export const Route = createFileRoute("/_app/settings")({
  // The loader stays in the first load, so its schemas load with the page. Reading the device's
  // copy (#106), the owner context comes from that.
  loader: async ({ context }): Promise<{ ownerContext: FromWorker<OwnerContextDetail> }> => ({
    ownerContext:
      context.reading === undefined
        ? await import("../../api/worker-calls.ts").then((calls) => calls.loadOwnerContext())
        : { kind: "loaded", data: context.reading.ownerContext },
  }),
  component: Settings,
});

/**
 * Settings (#102): everything that used to be on Home besides the workspaces, as it was there.
 * The owner context, the context backup when it needs the owner (`#backup`, where Home's Fix it
 * goes), the sign-in offers and Connections (`#connections`) with this device's notifications and
 * Read offline (#106), Fresh start, and logging out every other device. On a desktop it's in the
 * sidebar; on a touch screen, in the frame's Settings sheet. Read from the device's copy, only the
 * owner context and Read offline, with the grey line saying it's a copy.
 */
function Settings() {
  const workspaces = loggedIn.useLoaderData();
  const { reading } = loggedIn.useRouteContext();
  const { ownerContext } = Route.useLoaderData();
  const list = workspaces.kind === "loaded" ? workspaces.data.workspaces : [];
  const onThisDevice = (
    <div className="flex flex-col gap-3">
      <Suspense fallback={null}>
        <Notifications />
      </Suspense>
      <Suspense fallback={null}>
        <ReadOffline />
      </Suspense>
    </div>
  );

  if (reading !== undefined) {
    return (
      <Page
        header={<PageTitle>Settings</PageTitle>}
        footer={
          <div className="pt-2 pb-3 md:pb-6">
            <OfflineLine at={reading.at} />
          </div>
        }
      >
        <OwnerContextPanel result={ownerContext} canGetToKnow={false} />
        <div className="mt-6">
          <Suspense fallback={null}>
            <ReadOffline reading />
          </Suspense>
        </div>
      </Page>
    );
  }

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
        <SignIns part="list" beside={onThisDevice} />
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
