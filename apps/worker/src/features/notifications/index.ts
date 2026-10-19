import { generateKeyPairSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApprovalAsk,
  NotificationSubscription,
  type NotifyMe,
  type PullRequest,
  type PushNotice,
  type SessionEvent,
  type SessionId,
} from "@courtyard/contract";
import { z } from "zod";
import { DeviceLogin, type StorageError } from "../../auth/owner/index.ts";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { createOneAtATime } from "../../lib/one-at-a-time.ts";
import { err, ok, type Result } from "../../lib/result.ts";

/** The worker's own keys, which every notification it sends is signed with (VAPID). */
const PushKeys = z.object({ publicKey: z.string(), privateKey: z.string() });
export type PushKeys = z.infer<typeof PushKeys>;

/** How a push went: sent, or the device's subscription has gone (unsubscribed, or expired). */
export type PushSent = Result<null, "gone" | "failed">;

/**
 * Sends one notification to one device: `payload` is the notice as JSON, encrypted for that
 * device alone and signed with the worker's keys. Passed in, so tests read what was sent.
 */
export type SendPush = (push: {
  subscription: NotificationSubscription;
  payload: string;
  keys: PushKeys;
}) => Promise<PushSent>;

/** Each device that turned notifications on, by its device login, with its subscription. */
const DevicesFile = z.object({
  devices: z.array(z.object({ device: DeviceLogin, subscription: NotificationSubscription })),
});
type Device = z.infer<typeof DevicesFile>["devices"][number];

const STORAGE: StorageError = {
  kind: "storage",
  message: "Courtyard couldn't read or keep its notifications in its data folder.",
};

/** What an approval needs, as a notification says it. */
const approvalNeed = (ask: ApprovalAsk) => {
  switch (ask.kind) {
    case "command":
      return "Needs your OK to run a command";
    case "tool":
      return `Needs your OK to delete something in ${ask.connection}`;
    case "edit":
    case "setup":
      return "Needs your OK to change a file";
  }
};

/**
 * What a notification says a session needs, and whether it needs the owner (#493): an approval,
 * a failure, a pull request ready to merge or a question to answer does; a turn that just
 * finished is news, sent only to a workspace on Everything.
 */
type Need = { readonly says: string; readonly needsYou: boolean };

/** Marks a reply may close on after its question: bold, italics, a bracket or quotes. */
const CLOSING_MARKS = /[\s*_)"'”’]+$/;

/**
 * Whether the turn a session's event `ended` ended was asking the owner something: replies were
 * suggested for its question (ADR 0017), or its answer's last words end in a question mark. By
 * that event, since the next turn may have ended too by the time the events are read.
 */
const endsAsking = (events: readonly SessionEvent[], ended: number) => {
  const ending = (event: SessionEvent) =>
    event.type === "turn-completed" || event.type === "turn-failed" || event.type === "turn-stopped";
  const ends = events.findIndex((event) => event.seq === ended);
  if (ends === -1) return false;
  const before = events.findLastIndex((event, index) => index < ends && ending(event));
  const turn = events.slice(before + 1, ends);
  if (turn.some((event) => event.type === "suggested-replies")) return true;
  const answer = turn.flatMap((event) => (event.type === "text-delta" ? [event.text] : []));
  return answer.join("").replace(CLOSING_MARKS, "").endsWith("?");
};

/**
 * What a session needs, as a notification says it, for the events that send one: a turn that
 * ends with its code session's pull request still failing checks says which (story 31), one that
 * ends asking the owner something says so (#493), and a pull request whose checks failed again
 * after a re-run asks the owner what to do (#356).
 */
const needOf = async (
  event: SessionEvent,
  pullRequest: PullRequest | undefined,
  asks: () => Promise<boolean>,
): Promise<Need | undefined> => {
  switch (event.type) {
    case "pull-request":
      return event.pullRequest.checks.kind === "failed"
        ? {
            says: `Failed again after a re-run: ${event.pullRequest.checks.failed.join(", ")}. Flaky, or does it need fixing?`,
            needsYou: true,
          }
        : undefined;
    case "approval-requested":
      return { says: approvalNeed(event.ask), needsYou: true };
    case "turn-completed":
      if (pullRequest?.state === "open" && pullRequest.checks.kind === "failed") {
        return { says: `Checks still failing: ${pullRequest.checks.failed.join(", ")}`, needsYou: true };
      }
      return (await asks())
        ? { says: "Has a question for you", needsYou: true }
        : { says: "Turn finished", needsYou: false };
    case "turn-failed":
      return { says: "Turn failed", needsYou: true };
    default:
      return undefined;
  }
};

/** Whether a workspace on `notify` hears of a need. */
const hears = (notify: NotifyMe, need: Need) =>
  notify === "everything" || (notify === "needs-me" && need.needsYou);

/** A new pair of P-256 keys, in the base64url form browsers and push services take. */
const newKeys = (): PushKeys => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const point = publicKey.export({ format: "jwk" });
  const secret = privateKey.export({ format: "jwk" });
  if (point.x === undefined || point.y === undefined || secret.d === undefined) {
    throw new Error("Node gave a P-256 key without its parts");
  }
  const raw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(point.x, "base64url"),
    Buffer.from(point.y, "base64url"),
  ]);
  return { publicKey: raw.toString("base64url"), privateKey: secret.d };
};

/**
 * Notifications (#173): web push to the devices the owner turned them on for, when a session
 * needs an approval and when a turn finishes or fails. The worker's keys are made on its first
 * run, and each device's subscription is kept by its device login in the data folder, so a
 * device that logs out gets no more.
 */
export const createNotifications = (options: {
  dataDir: string;
  send: SendPush;
  /** The devices logged in now: only these are sent to. */
  devicesLoggedIn: () => Promise<Result<ReadonlySet<DeviceLogin>, StorageError>>;
  /** A session's title, as a notification says it, and what its workspace notifies of (#493). */
  sessionOf: (
    session: SessionId,
  ) => Promise<{ readonly title: string; readonly notify: NotifyMe } | undefined>;
  /** A session's events so far, to tell whether its last turn asked the owner something. */
  eventsOf: (session: SessionId) => Promise<readonly SessionEvent[] | undefined>;
}) => {
  const folder = join(options.dataDir, "notifications");
  const keysPath = join(folder, "keys.json");
  const devicesPath = join(folder, "devices.json");

  /** Changes to the devices one at a time, so two can't each read the file before the other writes. */
  const oneAtATime = createOneAtATime();

  const readKeys = async (): Promise<Result<PushKeys, StorageError>> => {
    const kept = await readJsonFile(keysPath, PushKeys);
    if (!kept.ok) return err(STORAGE);
    if (kept.value !== undefined) return ok(kept.value);
    try {
      await mkdir(folder, { recursive: true });
    } catch {
      return err(STORAGE);
    }
    const made = newKeys();
    const written = await writeJsonFile(keysPath, made, { exclusive: true });
    // Another request made them first: theirs stand.
    if (!written.ok && written.error === "exists") return readKeys();
    return written.ok ? ok(made) : err(STORAGE);
  };
  /** Made once, on first need, and the same from then on. */
  let keys: Promise<Result<PushKeys, StorageError>> | undefined;
  const ownKeys = () => {
    keys ??= readKeys().then((read) => {
      if (!read.ok) keys = undefined;
      return read;
    });
    return keys;
  };

  const readDevices = async (): Promise<Result<Device[], StorageError>> => {
    const file = await readJsonFile(devicesPath, DevicesFile);
    if (!file.ok) return err(STORAGE);
    return ok(file.value?.devices ?? []);
  };
  /** Changes the devices kept, one change at a time. */
  const changeDevices = (change: (devices: Device[]) => Device[]) =>
    oneAtATime(async (): Promise<Result<null, StorageError>> => {
      const devices = await readDevices();
      if (!devices.ok) return devices;
      try {
        await mkdir(folder, { recursive: true });
      } catch {
        return err(STORAGE);
      }
      const written = await writeJsonFile(devicesPath, { devices: change(devices.value) });
      return written.ok ? ok(null) : err(STORAGE);
    });

  /**
   * Sends a notification to every device logged in that turned them on, its title asked for once
   * there's a device to send to. A device whose subscription has gone, or that logged out, is
   * forgotten.
   */
  const send = async (pushed: PushNotice | (() => Promise<PushNotice | undefined>)) => {
    // No device has them on: nothing to send, nor keys to make.
    const devices = await readDevices();
    if (!devices.ok || devices.value.length === 0) return;
    const [own, loggedIn, notice] = await Promise.all([
      ownKeys(),
      options.devicesLoggedIn(),
      typeof pushed === "function" ? pushed() : pushed,
    ]);
    if (!own.ok || !loggedIn.ok || notice === undefined) return;
    const payload = JSON.stringify(notice);
    const sending = devices.value.filter(({ device }) => loggedIn.value.has(device));
    const loggedOut = devices.value.filter(({ device }) => !loggedIn.value.has(device));
    const sent = await Promise.all(
      sending.map(async (entry) => ({
        entry,
        sent: await options.send({ subscription: entry.subscription, payload, keys: own.value }),
      })),
    );
    const forget = [
      ...loggedOut,
      ...sent.flatMap(({ entry, sent }) => (!sent.ok && sent.error === "gone" ? [entry] : [])),
    ];
    if (forget.length === 0) return;
    // Only these entries: a device that turned them on meanwhile stays.
    await changeDevices((kept) =>
      kept.filter(
        ({ device, subscription }) =>
          !forget.some(
            (gone) =>
              gone.device === device && gone.subscription.endpoint === subscription.endpoint,
          ),
      ),
    );
  };

  /**
   * Sends a notification of what a session needs, with its title, when its workspace hears of it
   * (#493). `need` is worked out only once there's a device to send to.
   */
  const notice = (session: SessionId, need: () => Promise<Need | undefined>) =>
    send(async () => {
      const found = await options.sessionOf(session);
      if (found === undefined || found.notify === "nothing") return undefined;
      const needs = await need();
      return needs !== undefined && hears(found.notify, needs)
        ? { title: found.title, body: needs.says, session }
        : undefined;
    });

  return {
    /** The worker's public key, made on its first run. */
    publicKey: async (): Promise<Result<string, StorageError>> => {
      const own = await ownKeys();
      return own.ok ? ok(own.value.publicKey) : own;
    },

    /** Turns notifications on for this device, with its browser's subscription. */
    turnOn: (device: DeviceLogin, subscription: NotificationSubscription) =>
      changeDevices((devices) => [
        // One subscription per device, and each subscription for one device only.
        ...devices.filter(
          (kept) => kept.device !== device && kept.subscription.endpoint !== subscription.endpoint,
        ),
        { device, subscription },
      ]),

    /** Turns notifications off for the device with this subscription. */
    turnOff: (endpoint: string) =>
      changeDevices((devices) => devices.filter((kept) => kept.subscription.endpoint !== endpoint)),

    /** Sends a notification when a session's event is one the owner hears about. */
    sessionEvent: (
      session: SessionId,
      event: SessionEvent,
      pullRequest: PullRequest | undefined,
    ) =>
      notice(session, () =>
        needOf(event, pullRequest, async () => {
          const events = await options.eventsOf(session);
          return events !== undefined && endsAsking(events, event.seq);
        }),
      ),

    /**
     * Sends a notification saying what a session needs, with no event of its own: a Lead's
     * builder's pull request ready to merge or stalled (#347), or a plan's usage nearing its
     * limit (#66). Each needs the owner, so a workspace on Nothing alone hears none.
     */
    needs: (session: SessionId, says: string) =>
      notice(session, async () => ({ says, needsYou: true })),

    /**
     * The one notification after a crash or a restart of the PC (#186): which sessions' turns it
     * cut off, waiting for Continue, but those of workspaces on Nothing (#493). A tap opens the
     * first; the rest wait in Needs you.
     */
    restarted: async (cutOff: readonly { readonly id: SessionId; readonly title: string }[]) => {
      const heard = await Promise.all(
        cutOff.map(async (session) => (await options.sessionOf(session.id))?.notify !== "nothing"),
      );
      const told = cutOff.filter((_, index) => heard[index]);
      const [first] = told;
      if (first === undefined) return;
      const turns = told.length === 1 ? "1 turn" : `${told.length} turns`;
      return send({
        title: `Courtyard restarted · ${turns} stopped`,
        body: `${told.map((session) => session.title).join(", ")}. Tap to continue ${told.length === 1 ? "it" : "them"}.`,
        session: first.id,
      });
    },
  };
};

export type Notifications = ReturnType<typeof createNotifications>;
