import { NotificationsStatus } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// Notifications' calls live with them rather than in worker.ts, so their schemas stay off the
// first load.

/** The worker's public key, which this device's browser subscribes with (#173). */
export const loadNotifications = () => fromWorker("/notifications", NotificationsStatus);

/** Turns notifications on for this device, with its browser's subscription. */
export const turnOnHere = (subscription: PushSubscriptionJSON) =>
  sendJson({ path: "/notifications/on", body: subscription, schema: z.unknown() });

/** Turns notifications off for this device, by its subscription's endpoint. */
export const turnOffHere = (endpoint: string) =>
  sendJson({ path: "/notifications/off", body: { endpoint }, schema: z.unknown() });
