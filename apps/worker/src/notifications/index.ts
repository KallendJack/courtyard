import { generateKeyPairSync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApprovalAsk,
  NotificationSubscription,
  type PullRequest,
  type PushNotice,
  type SessionEvent,
  type SessionId,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../files.ts";
import { createOneAtATime } from "../one-at-a-time.ts";
import { DeviceLogin, type StorageError } from "../owner/index.ts";
import { err, ok, type Result } from "../result.ts";

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
 * What a session needs, as a notification says it, for the events that send one: a turn that
 * ends with its code session's pull request still failing checks says which (story 31).
 */
const needOf = (event: SessionEvent, pullRequest: PullRequest | undefined) => {
  switch (event.type) {
    case "approval-requested":
      return approvalNeed(event.ask);
    case "turn-completed":
      return pullRequest?.state === "open" && pullRequest.checks.kind === "failed"
        ? `Checks still failing: ${pullRequest.checks.failed.join(", ")}`
        : "Turn finished";
    case "turn-failed":
      return "Turn failed";
    default:
      return undefined;
  }
};

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
  /** A session's title, as a notification says it. */
  titleOf: (session: SessionId) => Promise<string | undefined>;
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

    /**
     * Sends a notification, when a session's event is one the owner hears about, to every device
     * logged in that turned them on. A device whose subscription has gone, or that logged out,
     * is forgotten.
     */
    sessionEvent: async (
      session: SessionId,
      event: SessionEvent,
      pullRequest: PullRequest | undefined,
    ) => {
      const need = needOf(event, pullRequest);
      if (need === undefined) return;
      // No device has them on: nothing to send, nor keys to make.
      const devices = await readDevices();
      if (!devices.ok || devices.value.length === 0) return;
      const [own, loggedIn, title] = await Promise.all([
        ownKeys(),
        options.devicesLoggedIn(),
        options.titleOf(session),
      ]);
      if (!own.ok || !loggedIn.ok || title === undefined) return;
      const notice: PushNotice = { title, body: need, session };
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
    },
  };
};

export type Notifications = ReturnType<typeof createNotifications>;
