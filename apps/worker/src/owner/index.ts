import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AuthState, MIN_PASSWORD_LENGTH } from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../result.ts";

type ScryptCost = { N: number; r: number; p: number; maxmem: number };

const scryptAsync = (password: string, salt: Buffer, keyLength: number, cost: ScryptCost) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, cost, (error, key) => (error ? reject(error) : resolve(key)));
  });

/** scrypt's cost settings: about 16 MB of memory per hash, so guessing in bulk is expensive. */
const COST = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

/** Wrong passwords in a row that cost nothing; after these, each one locks login for longer. */
const FREE_GUESSES = 3;
const MAX_LOCK_MS = 15 * 60 * 1000;

const OwnerFile = z.object({ passwordHash: z.string() });
const DeviceLogins = z.object({
  logins: z.array(z.object({ tokenHash: z.string(), createdAt: z.string() })),
});
const Guard = z.object({ failures: z.number().int().min(0), lockedUntil: z.number() });
type Guard = z.infer<typeof Guard>;

export type SetUpError = { readonly kind: "already-set-up" } | { readonly kind: "too-short" };
export type LogInError =
  | { readonly kind: "not-set-up" }
  | { readonly kind: "wrong-password" }
  | { readonly kind: "locked"; readonly retryAfterSeconds: number };

/** The owner's login: one password, and a login per device (ADR 0002). */
export type Owner = {
  /** Where this device stands, given its login token (if it sent one). */
  readonly state: (token: string | undefined) => Promise<AuthState["state"]>;
  /** Creates the owner, once, and returns a login token for this device. */
  readonly setUp: (password: string) => Promise<Result<string, SetUpError>>;
  /** Checks the password and returns a new login token for this device. */
  readonly logIn: (password: string) => Promise<Result<string, LogInError>>;
  /** Ends this device's login only. */
  readonly logOut: (token: string) => Promise<void>;
};

const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join(
    "$",
  );
};

const passwordMatches = async (password: string, stored: string) => {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: COST.maxmem,
  });
  return timingSafeEqual(actual, expected);
};

/** Only a hash of each token is stored, so the data folder alone can't log anyone in. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

export const createOwner = (options: { dataDir: string; now: () => number }): Owner => {
  const ownerPath = join(options.dataDir, "owner.json");
  const loginsPath = join(options.dataDir, "device-logins.json");
  const guardPath = join(options.dataDir, "login-guard.json");

  const readJson = async <T>(path: string, schema: z.ZodType<T>, empty: T): Promise<T> => {
    try {
      return schema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (hasCode(error, "ENOENT")) return empty;
      throw error;
    }
  };

  /** Writes to a temporary file first, so a crash mid-write never leaves half a file. */
  const writeJson = async (path: string, value: unknown) => {
    await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2));
    await rename(`${path}.tmp`, path);
  };

  const readOwner = () => readJson(ownerPath, OwnerFile.nullable(), null);
  const readLogins = () => readJson(loginsPath, DeviceLogins, { logins: [] });
  const readGuard = () => readJson(guardPath, Guard, { failures: 0, lockedUntil: 0 });

  const newLogin = async () => {
    const token = randomBytes(32).toString("base64url");
    const { logins } = await readLogins();
    logins.push({ tokenHash: hashToken(token), createdAt: new Date(options.now()).toISOString() });
    await writeJson(loginsPath, { logins });
    return token;
  };

  const isLoggedIn = async (token: string | undefined) => {
    if (!token) return false;
    const tokenHash = hashToken(token);
    return (await readLogins()).logins.some((login) => login.tokenHash === tokenHash);
  };

  const recordFailure = async (guard: Guard) => {
    const failures = guard.failures + 1;
    const lockMs =
      failures > FREE_GUESSES
        ? Math.min(1000 * 2 ** (failures - FREE_GUESSES - 1), MAX_LOCK_MS)
        : 0;
    await writeJson(guardPath, { failures, lockedUntil: options.now() + lockMs });
  };

  return {
    state: async (token) => {
      if ((await readOwner()) === null) return "setup-needed";
      return (await isLoggedIn(token)) ? "logged-in" : "logged-out";
    },

    setUp: async (password) => {
      if (password.length < MIN_PASSWORD_LENGTH) return err({ kind: "too-short" });
      const owner = { passwordHash: await hashPassword(password) };
      try {
        // `wx` fails if the file exists, so two setups racing can't both win.
        await writeFile(ownerPath, JSON.stringify(owner, null, 2), { flag: "wx" });
      } catch (error) {
        if (hasCode(error, "EEXIST")) {
          return err({ kind: "already-set-up" });
        }
        throw error;
      }
      return ok(await newLogin());
    },

    logIn: async (password) => {
      const owner = await readOwner();
      if (owner === null) return err({ kind: "not-set-up" });

      const guard = await readGuard();
      const waitMs = guard.lockedUntil - options.now();
      if (waitMs > 0) return err({ kind: "locked", retryAfterSeconds: Math.ceil(waitMs / 1000) });

      if (!(await passwordMatches(password, owner.passwordHash))) {
        await recordFailure(guard);
        return err({ kind: "wrong-password" });
      }
      if (guard.failures > 0) await writeJson(guardPath, { failures: 0, lockedUntil: 0 });
      return ok(await newLogin());
    },

    logOut: async (token) => {
      const tokenHash = hashToken(token);
      const { logins } = await readLogins();
      await writeJson(loginsPath, { logins: logins.filter((l) => l.tokenHash !== tokenHash) });
    },
  };
};
