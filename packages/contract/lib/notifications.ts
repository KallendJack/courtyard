import { z } from "zod";
import { SessionId } from "./session.ts";

// Notifications (#173): web push to the devices the owner turned them on for, when a session needs
// an approval and when a turn finishes or fails.

/** What a browser needs to turn notifications on: the worker's public key, to subscribe with. */
export const NotificationsStatus = z.object({
  /** The worker's public key, base64url, made on its first run and kept in the data folder. */
  publicKey: z.string(),
});
export type NotificationsStatus = z.infer<typeof NotificationsStatus>;

/**
 * A device's push subscription, as its browser gives it: where to send, and the keys a
 * notification is encrypted with for that browser alone. Turning notifications on sends it.
 */
export const NotificationSubscription = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type NotificationSubscription = z.infer<typeof NotificationSubscription>;

/** Turning a device's notifications off: its subscription, by where it was sent. */
export const NotificationsOff = z.object({ endpoint: z.url() });
export type NotificationsOff = z.infer<typeof NotificationsOff>;

/**
 * What a notification carries, and all it carries, since it shows on a locked screen: the
 * session's title, what it needs, and which session a tap opens.
 */
export const PushNotice = z.object({
  /** The session's title. */
  title: z.string(),
  /** What it needs: "Needs your OK to run a command". */
  body: z.string(),
  /** The session a tap opens. */
  session: SessionId,
});
export type PushNotice = z.infer<typeof PushNotice>;
