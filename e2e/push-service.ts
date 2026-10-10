import type { Page } from "@playwright/test";

/**
 * A stand-in for the browser's push service, for Chromium as Playwright runs it, which can't
 * show notifications (its permission reads "denied") or reach a push service. Asking permission
 * says yes, and subscribing gives a subscription made with the worker's key, kept in the page's
 * storage so it outlasts a reload as a real one does. Everything from there on (what the page
 * sends the worker, and the worker keeping it) is real.
 */
export const standInPushService = (page: Page) =>
  page.addInitScript(() => {
    const PERMISSION = "stand-in-notification-permission";
    const SUBSCRIPTION = "stand-in-push-subscription";
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => localStorage.getItem(PERMISSION) ?? "default",
    });
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => {
        localStorage.setItem(PERMISSION, "granted");
        return "granted";
      },
    });

    type Kept = { endpoint: string; key: number[] };
    const subscriptionOf = (kept: Kept) => ({
      endpoint: kept.endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(kept.key).buffer },
      toJSON: () => ({
        endpoint: kept.endpoint,
        expirationTime: null,
        keys: { p256dh: "stand-in-p256dh", auth: "stand-in-auth" },
      }),
      unsubscribe: async () => {
        localStorage.removeItem(SUBSCRIPTION);
        return true;
      },
    });

    Object.defineProperty(PushManager.prototype, "getSubscription", {
      configurable: true,
      value: async () => {
        const text = localStorage.getItem(SUBSCRIPTION);
        if (text === null) return null;
        const kept: Kept = JSON.parse(text);
        return subscriptionOf(kept);
      },
    });
    Object.defineProperty(PushManager.prototype, "subscribe", {
      configurable: true,
      value: async (options: PushSubscriptionOptionsInit | undefined) => {
        const key = options?.applicationServerKey;
        const bytes = ArrayBuffer.isView(key)
          ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength)
          : key instanceof ArrayBuffer
            ? new Uint8Array(key)
            : new Uint8Array();
        const made: Kept = {
          endpoint: `https://push.example/${crypto.randomUUID()}`,
          key: Array.from(bytes),
        };
        localStorage.setItem(SUBSCRIPTION, JSON.stringify(made));
        return subscriptionOf(made);
      },
    });
  });
