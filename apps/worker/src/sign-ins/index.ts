import { join } from "node:path";
import type { ProviderSignIn } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../files.ts";
import type { Provider, SignIn } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";

/** Where the providers the owner said Not now to are kept, in the data folder. */
const NOT_NOW_FILE = "sign-ins.json";
const NotNowFile = z.object({ notNow: z.array(z.string()) });

/** Why a sign-in couldn't be acted on. */
export type SignInProblem =
  | { readonly kind: "no-sign-in" }
  /** The provider couldn't do it, in its own plain words. */
  | { readonly kind: "provider"; readonly message: string }
  | { readonly kind: "storage" };

/**
 * Signing in, from the home page, to the providers whose sign-in Courtyard handles (ADR 0015):
 * each sign-in's state from its provider, and the owner's Not now, kept across restarts.
 */
export const createSignIns = (options: { providers: readonly Provider[]; dataDir: string }) => {
  const file = join(options.dataDir, NOT_NOW_FILE);
  const withSignIn = options.providers.flatMap((provider) =>
    provider.signIn === undefined ? [] : [{ provider, signIn: provider.signIn }],
  );
  const find = (id: string) => withSignIn.find(({ provider }) => provider.id === id);

  const notNow = async (): Promise<Result<readonly string[], "storage">> => {
    const read = await readJsonFile(file, NotNowFile);
    return read.ok ? ok(read.value?.notNow ?? []) : err("storage");
  };

  const shown = async (
    found: { provider: Provider; signIn: SignIn },
    dismissed: readonly string[],
  ): Promise<ProviderSignIn> => {
    const status = await found.provider.status();
    return {
      provider: found.provider.id,
      label: status.label,
      service: found.signIn.service,
      state: await found.signIn.state(),
      notNow: dismissed.includes(found.provider.id),
    };
  };

  /** Runs `act` on a provider's sign-in, then says where it stands. */
  const acting = async (
    id: string,
    act: (signIn: SignIn) => Promise<Result<unknown, string>>,
  ): Promise<Result<ProviderSignIn, SignInProblem>> => {
    const found = find(id);
    if (found === undefined) return err({ kind: "no-sign-in" });
    const acted = await act(found.signIn);
    if (!acted.ok) return err({ kind: "provider", message: acted.error });
    const dismissed = await notNow();
    if (!dismissed.ok) return err({ kind: "storage" });
    return ok(await shown(found, dismissed.value));
  };

  return {
    list: async (): Promise<Result<ProviderSignIn[], "storage">> => {
      const dismissed = await notNow();
      if (!dismissed.ok) return dismissed;
      return ok(await Promise.all(withSignIn.map((found) => shown(found, dismissed.value))));
    },
    start: (id: string) => acting(id, (signIn) => signIn.start()),
    cancel: (id: string) =>
      acting(id, async (signIn) => {
        await signIn.cancel();
        return ok(null);
      }),
    signOut: (id: string) => acting(id, (signIn) => signIn.signOut()),

    /** The owner said Not now: the home page stops asking them to sign in. */
    notNow: async (id: string): Promise<Result<null, SignInProblem>> => {
      if (find(id) === undefined) return err({ kind: "no-sign-in" });
      const dismissed = await notNow();
      if (!dismissed.ok) return err({ kind: "storage" });
      if (dismissed.value.includes(id)) return ok(null);
      const written = await writeJsonFile(file, { notNow: [...dismissed.value, id] });
      return written.ok ? ok(null) : err({ kind: "storage" });
    },
  };
};

export type SignIns = ReturnType<typeof createSignIns>;
