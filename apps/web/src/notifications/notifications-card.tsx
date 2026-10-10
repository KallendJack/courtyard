import { useEffect, useState } from "react";
import { CapsLabel } from "@/components/caps-label";
import { FormError } from "@/components/form-error";
import { CARD } from "@/components/page";
import { Switch } from "@/components/switch";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { loadNotifications, turnOffHere, turnOnHere } from "./api.ts";

/** Where notifications stand on this device. */
type Here =
  | { readonly kind: "checking" }
  /** This browser can't have them, or the owner blocked them for Courtyard: why. */
  | { readonly kind: "unavailable"; readonly why: string }
  | {
      readonly kind: "ready";
      readonly registration: ServiceWorkerRegistration;
      /** The worker's public key, which this browser subscribes with. */
      readonly key: Uint8Array<ArrayBuffer>;
      readonly on: boolean;
    };

const CANT =
  "This browser can't have them here: Courtyard needs to be opened over HTTPS, and on an iPhone added to the Home Screen first.";
const BLOCKED =
  "Notifications are blocked for Courtyard in this browser's settings. Allow them there, then turn them on here.";

/** A base64url key as the bytes a browser subscribes with. */
const bytesOf = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

/** Whether a subscription was made with this key: one made with an older key no longer works. */
const madeWith = (subscription: PushSubscription, key: Uint8Array) => {
  const its = subscription.options.applicationServerKey;
  if (its === null) return false;
  const bytes = new Uint8Array(its);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
};

/**
 * Where this device stands. A subscription it already has is sent to the worker again, so it
 * follows this device's login (a new one after logging in again) and survives a worker that lost it.
 */
const checkHere = async (): Promise<Here> => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return { kind: "unavailable", why: CANT };
  if (Notification.permission === "denied") return { kind: "unavailable", why: BLOCKED };
  const [registration, status] = await Promise.all([
    navigator.serviceWorker.ready,
    loadNotifications(),
  ]);
  if (status.kind !== "loaded") return { kind: "unavailable", why: describeProblem(status).body };
  const key = bytesOf(status.data.publicKey);
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null || Notification.permission !== "granted") {
    return { kind: "ready", registration, key, on: false };
  }
  if (!madeWith(subscription, key)) {
    await subscription.unsubscribe();
    return { kind: "ready", registration, key, on: false };
  }
  const kept = await turnOnHere(subscription.toJSON());
  return { kind: "ready", registration, key, on: kept.kind === "loaded" };
};

/** Subscribes this browser and tells the worker: what went wrong, or nothing once it's on. */
const turnOn = async (here: Extract<Here, { kind: "ready" }>) => {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return BLOCKED;
  if (permission !== "granted") return "Notifications weren't allowed, so they're still off.";
  let subscription: PushSubscription;
  try {
    subscription = await here.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: here.key,
    });
  } catch {
    return "This browser couldn't turn notifications on just now. Try again in a moment.";
  }
  const done = await turnOnHere(subscription.toJSON());
  if (done.kind === "loaded") return undefined;
  await subscription.unsubscribe();
  return describeProblem(done).body;
};

/** Tells the worker, then unsubscribes this browser: what went wrong, or nothing once it's off. */
const turnOff = async (here: Extract<Here, { kind: "ready" }>) => {
  const subscription = await here.registration.pushManager.getSubscription();
  if (subscription === null) return undefined;
  const done = await turnOffHere(subscription.endpoint);
  if (done.kind !== "loaded") return describeProblem(done).body;
  await subscription.unsubscribe();
  return undefined;
};

/**
 * Notifications, beside Connections on the home page (#173): turned on per device, for when a
 * session needs the owner's OK and when a turn finishes or fails.
 */
export default function NotificationsCard() {
  const [here, setHere] = useState<Here>({ kind: "checking" });
  useEffect(() => {
    let current = true;
    void checkHere().then((checked) => {
      if (current) setHere(checked);
    });
    return () => {
      current = false;
    };
  }, []);
  const action = useAction(async (on: boolean) => {
    if (here.kind !== "ready") return undefined;
    const problem = on ? await turnOn(here) : await turnOff(here);
    if (problem === undefined) setHere({ ...here, on });
    else if (problem === BLOCKED) setHere({ kind: "unavailable", why: BLOCKED });
    return problem === BLOCKED ? undefined : problem;
  });

  return (
    <section aria-labelledby="notifications" className={classes(CARD, "flex flex-col gap-3")}>
      <CapsLabel tone="muted" heading={{ id: "notifications" }}>
        Notifications
      </CapsLabel>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.75">
          <span id="notifications-here" className="font-extrabold">
            On this device
          </span>
          <span id="notifications-when" className="text-xs text-muted-foreground">
            {here.kind === "unavailable"
              ? here.why
              : "When a session needs your OK, or a turn finishes or fails."}
          </span>
        </div>
        <Switch
          on={here.kind === "ready" && here.on}
          onChange={(on) => void action.run(on)}
          disabled={here.kind !== "ready" || action.busy}
          labelledBy="notifications-here"
          describedBy="notifications-when"
        />
      </div>
      <FormError message={action.error} />
      <div className="h-px shrink-0 bg-border" />
      <p className="text-xs text-muted-foreground">
        Each device turns its own on. Only the title and what it needs show on a locked screen.
      </p>
    </section>
  );
}
