import {
  NotificationSubscription,
  NotificationsOff,
  type NotificationsStatus,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, readBody } from "../http.ts";
import type { StorageError } from "../owner/index.ts";
import { deviceLoginFrom } from "../owner/routes.ts";
import type { Notifications } from "./index.ts";

const storageError = (c: Context, error: StorageError) =>
  apiError(c, { status: 500, error: error.message });

/** Notifications, turned on and off per device from the home page (#173). */
export const notificationRoutes = (notifications: Notifications) => {
  const routes = new Hono();

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
