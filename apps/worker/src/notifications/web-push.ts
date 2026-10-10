import webpush from "web-push";
import { err, ok } from "../result.ts";
import type { SendPush } from "./index.ts";

/**
 * Who sends Courtyard's notifications, as the push services ask (VAPID's subject). They want a
 * `mailto:` or an `https:` address; nothing is ever sent to it.
 */
const SENDER = "mailto:courtyard@courtyard.example";

/** How long a push service keeps a notification for a device that's off: a day. */
const KEEP_SECONDS = 24 * 60 * 60;

/** The real sender: web push to each device's push service (Google's, Apple's, Mozilla's). */
export const sendWebPush: SendPush = async ({ subscription, payload, keys }) => {
  try {
    await webpush.sendNotification(subscription, payload, {
      vapidDetails: { subject: SENDER, ...keys },
      TTL: KEEP_SECONDS,
      urgency: "high",
    });
    return ok(null);
  } catch (error) {
    // The subscription has gone: unsubscribed, or expired.
    if (error instanceof webpush.WebPushError && [404, 410].includes(error.statusCode)) {
      return err("gone");
    }
    console.error("A notification couldn't be sent", error);
    return err("failed");
  }
};
