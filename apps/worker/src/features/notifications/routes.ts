import {
  NotificationSubscription,
  NotificationsOff,
  type NotificationsStatus,
  type NotifyMe,
  NotifyMeSetting,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import type { StorageError } from "../../auth/owner/index.ts";
import { deviceLoginFrom } from "../../auth/owner/routes.ts";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import { type ContextFolder, workspaceChange } from "../context-folder/index.ts";
import { getWorkspace, keepNotify } from "../workspaces/index.ts";
import type { Notifications } from "./index.ts";

const storageError = (c: Context, error: StorageError) =>
  apiError(c, { status: 500, error: error.message });

/** What each choice is called, as the change that keeps it says. */
const NOTIFY_NAMES: Record<NotifyMe, string> = {
  everything: "Everything",
  "needs-me": "Only what needs me",
  nothing: "Nothing",
};

/**
 * Notifications, turned on and off per device from Settings (#173), and what each workspace
 * notifies of, from its ⋯'s Notify me (#493).
 */
export const notificationRoutes = (target: {
  notifications: Notifications;
  contextDir: string;
  contextFolder: ContextFolder;
}) => {
  const { notifications, contextDir, contextFolder } = target;
  const routes = new Hono();

  routes.get("/workspaces/:id/notify", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json({ notify: workspace.value.notify } satisfies NotifyMeSetting);
  });
  /** Picks what a workspace notifies of: a change, with Undo. */
  routes.post("/workspaces/:id/notify", async (c) => {
    const body = await readBody(c, NotifyMeSetting);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const { notify } = body.value;
    const kept = await contextFolder.change(
      () => keepNotify(contextDir, { id: c.req.param("id"), notify }),
      (made) => workspaceChange(`Notify me: ${NOTIFY_NAMES[notify]}`, made.summary.id),
    );
    if (!kept.ok) return contextError(c, kept.error);
    return c.json({ notify: kept.value.notify } satisfies NotifyMeSetting);
  });

  routes.get("/notifications", async (c) => {
    const publicKey = await notifications.publicKey();
    if (!publicKey.ok) return storageError(c, publicKey.error);
    return c.json({ publicKey: publicKey.value } satisfies NotificationsStatus);
  });
  /** Turns them on for this device, with its browser's subscription. */
  routes.post("/notifications/on", async (c) => {
    const device = deviceLoginFrom(c);
    if (device === undefined) return apiError(c, { status: 401, error: "Log in first" });
    const body = await readBody(c, NotificationSubscription);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const done = await notifications.turnOn(device, body.value);
    return done.ok ? c.body(null, 204) : storageError(c, done.error);
  });
  /** Turns them off for the device with this subscription. */
  routes.post("/notifications/off", async (c) => {
    const body = await readBody(c, NotificationsOff);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const done = await notifications.turnOff(body.value.endpoint);
    return done.ok ? c.body(null, 204) : storageError(c, done.error);
  });

  return routes;
};
