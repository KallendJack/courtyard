import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { type AuthState, MIN_PASSWORD_LENGTH } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../files.ts";
import { createOneAtATime } from "../one-at-a-time.ts";
import { err, ok, type Result } from "../result.ts";

/** The secret in a device login's cookie. Only its hash is ever stored. */
export const LoginSecret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,100}$/)
  .brand<"LoginSecret">();
export type LoginSecret = z.infer<typeof LoginSecret>;

/**
 * One device login, as other modules name it (a device's notifications, say): its secret's hash,
 * the same one its login is kept by, so it's gone once that device logs out.
 */
export const DeviceLogin = z.string().min(1).brand<"DeviceLogin">();
export type DeviceLogin = z.infer<typeof DeviceLogin>;

/** scrypt's cost settings: about 16 MB of memory per hash, so guessing in bulk is expensive. */
const COST = { N: 2 ** 14, r: 8, p: 1 };
const MAX_MEMORY = 64 * 1024 * 1024;
const KEY_LENGTH = 32;

/** Wrong passwords in a row that cost nothing; after these, each one locks login for longer. */
const FREE_GUESSES = 3;
const MAX_LOCK_MS = 15 * 60 * 1000;
/** Wrong passwords older than this are forgotten, so an old typo never adds to a lock. */
const FORGET_AFTER_MS = 60 * 60 * 1000;

const StoredPassword = z.object({
  scheme: z.literal("scrypt"),
  N: z.number().int().positive(),
  r: z.number().int().positive(),
  p: z.number().int().positive(),
  salt: z.base64(),
  hash: z.base64(),
});
type StoredPassword = z.infer<typeof StoredPassword>;
const OwnerFile = z.object({ password: StoredPassword });
const DeviceLoginsFile = z.object({
  logins: z.array(z.object({ secretHash: z.string(), createdAt: z.iso.datetime() })),
});
const FailedLoginsFile = z.object({
  count: z.number().int().min(0),
  lastAt: z.number(),
  lockedUntil: z.number(),
});
type FailedLogins = z.infer<typeof FailedLoginsFile>;

/** The data folder couldn't be read or written. */
export type StorageError = { readonly kind: "storage"; readonly message: string };
export type SetUpError = { readonly kind: "already-set-up" } | { readonly kind: "too-short" };
export type LogInError =
  | { readonly kind: "not-set-up" }
  | { readonly kind: "wrong-password" }
  | { readonly kind: "locked"; readonly retryAfterSeconds: number };

/** The owner's login: one password, and a login per device (ADR 0002). */
export type Owner = {
  /** Where this device stands, given the secret from its cookie (if it sent one). */
  readonly state: (
    secret: LoginSecret | undefined,
  ) => Promise<Result<AuthState["state"], StorageError>>;
  /** Creates the owner, once, and logs this device in. */
  readonly setUp: (password: string) => Promise<Result<LoginSecret, SetUpError | StorageError>>;
  /** Checks the password and logs this device in. */
  readonly logIn: (password: string) => Promise<Result<LoginSecret, LogInError | StorageError>>;
  /** Ends this device's login only. */
  readonly logOut: (secret: LoginSecret) => Promise<Result<null, StorageError>>;
  /** Ends every device login except this one, so a lost device can be cut off. */
  readonly logOutOthers: (secret: LoginSecret) => Promise<Result<null, StorageError>>;
  /** The devices logged in now. */
  readonly devices: () => Promise<Result<ReadonlySet<DeviceLogin>, StorageError>>;
};

const scryptKey = (password: string, salt: Buffer, cost: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("base64url");

/** The device login a login secret is. */
export const deviceLoginOf = (secret: LoginSecret) => DeviceLogin.parse(hashSecret(secret));

const storage = (message: string): StorageError => ({ kind: "storage", message });

export const createOwner = (options: { dataDir: string; now: () => number }): Owner => {
  const ownerPath = join(options.dataDir, "owner.json");
  const loginsPath = join(options.dataDir, "device-logins.json");
  const failuresPath = join(options.dataDir, "failed-logins.json");

  /**
   * Runs changes one at a time. Without this, guesses sent together would all read the same
   * failure count and skip the slow-down, and a login and a logout could undo each other.
   */
  const oneAtATime = createOneAtATime();

  const read = async <T>(path: string, schema: z.ZodType<T>) => {
    const file = await readJsonFile(path, schema);
    return file.ok ? file : err(storage("A file in Courtyard's data folder can't be read."));
  };
  const write = async (path: string, value: unknown) => {
    const written = await writeJsonFile(path, value);
    return written.ok
      ? ok(null)
      : err(storage("A file in Courtyard's data folder can't be written."));
  };

  const newLogin = async (): Promise<Result<LoginSecret, StorageError>> => {
    const secret = LoginSecret.parse(randomBytes(32).toString("base64url"));
    const file = await read(loginsPath, DeviceLoginsFile);
    if (!file.ok) return file;
    const logins = file.value?.logins ?? [];
    const createdAt = new Date(options.now()).toISOString();
    const written = await write(loginsPath, {
      logins: [...logins, { secretHash: hashSecret(secret), createdAt }],
    });
    return written.ok ? ok(secret) : written;
  };

  /** Keeps only the device logins whose secret hash `keep` says yes to. */
  const keepLogins = (keep: (secretHash: string) => boolean) =>
    oneAtATime(async (): Promise<Result<null, StorageError>> => {
      const file = await read(loginsPath, DeviceLoginsFile);
      if (!file.ok) return file;
      const logins = (file.value?.logins ?? []).filter((login) => keep(login.secretHash));
      return write(loginsPath, { logins });
    });

  const currentFailures = async (): Promise<Result<FailedLogins, StorageError>> => {
    const file = await read(failuresPath, FailedLoginsFile);
    if (!file.ok) return file;
    const failures = file.value ?? { count: 0, lastAt: 0, lockedUntil: 0 };
    const forgotten = options.now() - failures.lastAt > FORGET_AFTER_MS;
    return ok(forgotten ? { ...failures, count: 0 } : failures);
  };

  const passwordMatches = async (password: string, stored: StoredPassword) => {
    const expected = Buffer.from(stored.hash, "base64");
    const actual = await scryptKey(password, Buffer.from(stored.salt, "base64"), stored);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  const recordFailure = (count: number) => {
    const lockMs =
      count > FREE_GUESSES ? Math.min(1000 * 2 ** (count - FREE_GUESSES - 1), MAX_LOCK_MS) : 0;
    const now = options.now();
    return write(failuresPath, { count, lastAt: now, lockedUntil: now + lockMs });
  };

  return {
    state: async (secret) => {
      const owner = await read(ownerPath, OwnerFile);
      if (!owner.ok) return owner;
      if (owner.value === undefined) return ok("setup-needed");
      if (secret === undefined) return ok("logged-out");
      const logins = await read(loginsPath, DeviceLoginsFile);
      if (!logins.ok) return logins;
      const secretHash = hashSecret(secret);
      const found = (logins.value?.logins ?? []).some((login) => login.secretHash === secretHash);
      return ok(found ? "logged-in" : "logged-out");
    },

    setUp: (password) =>
      oneAtATime(async (): Promise<Result<LoginSecret, SetUpError | StorageError>> => {
        if (password.length < MIN_PASSWORD_LENGTH) return err({ kind: "too-short" });
        // Checked before hashing, so asking again after setup costs nothing.
        const existing = await read(ownerPath, OwnerFile);
        if (!existing.ok) return existing;
        if (existing.value !== undefined) return err({ kind: "already-set-up" });

        const salt = randomBytes(16);
        const hash = await scryptKey(password, salt, COST);
        const stored: StoredPassword = {
          scheme: "scrypt",
          ...COST,
          salt: salt.toString("base64"),
          hash: hash.toString("base64"),
        };
        const created = await writeJsonFile(ownerPath, { password: stored }, { exclusive: true });
        if (!created.ok) {
          return created.error === "exists"
            ? err({ kind: "already-set-up" })
            : err(storage("A file in Courtyard's data folder can't be written."));
        }
        return newLogin();
      }),

    logIn: (password) =>
      oneAtATime(async (): Promise<Result<LoginSecret, LogInError | StorageError>> => {
        const owner = await read(ownerPath, OwnerFile);
        if (!owner.ok) return owner;
        if (owner.value === undefined) return err({ kind: "not-set-up" });

        const failures = await currentFailures();
        if (!failures.ok) return failures;
        const waitMs = failures.value.lockedUntil - options.now();
        if (waitMs > 0) return err({ kind: "locked", retryAfterSeconds: Math.ceil(waitMs / 1000) });

        if (!(await passwordMatches(password, owner.value.password))) {
          const recorded = await recordFailure(failures.value.count + 1);
          return recorded.ok ? err({ kind: "wrong-password" }) : recorded;
        }
        if (failures.value.count > 0) {
          const reset = await write(failuresPath, { count: 0, lastAt: 0, lockedUntil: 0 });
          if (!reset.ok) return reset;
        }
        return newLogin();
      }),

    logOut: (secret) => {
      const secretHash = hashSecret(secret);
      return keepLogins((hash) => hash !== secretHash);
    },

    logOutOthers: (secret) => {
      const secretHash = hashSecret(secret);
      return keepLogins((hash) => hash === secretHash);
    },

    devices: async () => {
      const file = await read(loginsPath, DeviceLoginsFile);
      if (!file.ok) return file;
      return ok(
        new Set((file.value?.logins ?? []).map((login) => DeviceLogin.parse(login.secretHash))),
      );
    },
  };
};
