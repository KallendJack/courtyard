import { join } from "node:path";
import { ProviderId, type ProviderSignIn } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../files.ts";
import type { Provider, SignIn } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";

/** Where the providers the owner said Not now to are kept, in the data folder. */
const NOT_NOW_FILE = "sign-ins.json";
const NotNowFile = z.object({ notNow: z.array(ProviderId) });

/** Why a sign-in couldn't be acted on. */
export type SignInProblem =
  | { readonly kind: "no-sign-in" }
  /** The provider couldn't do it, in its own plain words. */
  | { readonly kind: "provider"; readonly message: string }
  | { readonly kind: "storage" };

/**
 * Signing in, from the home page, to the providers whose sign-in Courtyard handles (ADR 0015):
 * each sign-in's state from its provider, and the owner's Not now, kept across restarts until they
 * sign in after all.
 */
export const createSignIns = (options: { providers: readonly Provider[]; dataDir: string }) => {
  const file = join(options.dataDir, NOT_NOW_FILE);
  const withSignIn = options.providers.flatMap((provider) =>
    provider.signIn === undefined ? [] : [{ provider, signIn: provider.signIn }],
  );
  const find = (id: ProviderId) => withSignIn.find(({ provider }) => provider.id === id);

  /** The providers the owner said Not now to. */
  const readNotNow = async (): Promise<Result<readonly ProviderId[], "storage">> => {
    const read = await readJsonFile(file, NotNowFile);
    return read.ok ? ok(read.value?.notNow ?? []) : err("storage");
  };
  const writeNotNow = async (ids: readonly ProviderId[]): Promise<Result<null, SignInProblem>> => {
    const written = await writeJsonFile(file, { notNow: ids });
    return written.ok ? ok(null) : err({ kind: "storage" });
  };

  const shown = async (
    found: { provider: Provider; signIn: SignIn },
    notNow: readonly ProviderId[],
  ): Promise<ProviderSignIn> => {
    // For its label: the status is kept for a while, so this rarely asks the provider.
    const status = await found.provider.status();
    return {
      provider: found.provider.id,
      label: status.label,
      service: found.signIn.service,
      state: await found.signIn.state(),
      notNow: notNow.includes(found.provider.id),
    };
  };

  /** Runs `act` on a provider's sign-in, then says where it stands. */
  const acting = async (
    name: string,
    act: (signIn: SignIn, id: ProviderId) => Promise<Result<unknown, SignInProblem>>,
  ): Promise<Result<ProviderSignIn, SignInProblem>> => {
    const id = ProviderId.safeParse(name);
    const found = id.success ? find(id.data) : undefined;
    if (!id.success || found === undefined) return err({ kind: "no-sign-in" });
    const acted = await act(found.signIn, id.data);
    if (!acted.ok) return acted;
    const notNow = await readNotNow();
    if (!notNow.ok) return err({ kind: "storage" });
    return ok(await shown(found, notNow.value));
  };

  /** The provider's own words, when it couldn't do what was asked. */
  const fromProvider = <T>(done: Result<T, string>): Result<T, SignInProblem> =>
    done.ok ? done : err({ kind: "provider", message: done.error });

  return {
    list: async (): Promise<Result<ProviderSignIn[], "storage">> => {
      const notNow = await readNotNow();
      if (!notNow.ok) return notNow;
      return ok(await Promise.all(withSignIn.map((found) => shown(found, notNow.value))));
    },

    /** Starts a sign-in; signing in after all forgets an earlier Not now. */
    start: (name: string) =>
      acting(name, async (signIn, id) => {
        const started = fromProvider(await signIn.start());
        if (!started.ok) return started;
        const notNow = await readNotNow();
        if (!notNow.ok) return err({ kind: "storage" });
        return notNow.value.includes(id)
          ? writeNotNow(notNow.value.filter((other) => other !== id))
          : ok(null);
      }),

    cancel: (name: string) =>
      acting(name, async (signIn) => {
        await signIn.cancel();
        return ok(null);
      }),

    signOut: (name: string) => acting(name, async (signIn) => fromProvider(await signIn.signOut())),

    /** The owner said Not now: the home page stops asking them to sign in. */
    notNow: (name: string) =>
      acting(name, async (_, id) => {
        const notNow = await readNotNow();
        if (!notNow.ok) return err({ kind: "storage" });
        return notNow.value.includes(id) ? ok(null) : writeNotNow([...notNow.value, id]);
      }),
  };
};

export type SignIns = ReturnType<typeof createSignIns>;
