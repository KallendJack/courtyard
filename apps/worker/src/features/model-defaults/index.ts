import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ModelDefault,
  type ModelInfo,
  ProviderId,
  type ProviderStatus,
  takesEffort,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import type { Provider } from "../../providers/index.ts";

/** The owner's defaults, by provider, as the data folder keeps them. */
const KeptDefaults = z.record(ProviderId, ModelDefault);

/** Why a default couldn't be made. */
export type DefaultError =
  | { readonly kind: "no-provider" }
  | { readonly kind: "not-offered"; readonly provider: string }
  | { readonly kind: "no-such-effort" }
  | { readonly kind: "storage" };

/**
 * A provider's default as it can be used now (#247): `wanted` while its model is on offer and not at
 * its usage limit, with its effort if the model takes it; else the first model that isn't, at its
 * own effort. When every one is at its limit, `wanted` still, or else the first model.
 */
const usableDefault = (
  models: readonly ModelInfo[],
  wanted: ModelDefault | undefined,
): ModelDefault | undefined => {
  const offered = models.find((model) => model.id === wanted?.model);
  const withRoom = models.find((model) => model.limit === undefined);
  const kept = offered?.limit === undefined || withRoom === undefined ? offered : undefined;
  if (kept !== undefined) {
    const effort = wanted?.effort;
    return effort !== undefined && takesEffort(kept, effort)
      ? { model: kept.id, effort }
      : { model: kept.id };
  }
  const first = withRoom ?? models[0];
  return first && { model: first.id };
};

/**
 * Each provider's default model and effort (#247): one for each provider, kept in the data folder,
 * starting on the provider's own starting default. `providers` lists each with its default as it
 * can be used now; `save` makes the owner's pick the default.
 */
export const createModelDefaults = (options: {
  dataDir: string;
  providers: readonly Provider[];
}) => {
  const file = join(options.dataDir, "model-defaults.json");
  /** The owner's defaults, read once; a file that can't be read leaves the starting ones. */
  let kept: Promise<Record<string, ModelDefault>> | undefined;
  const read = () => {
    kept ??= readJsonFile(file, KeptDefaults).then((read) => (read.ok ? (read.value ?? {}) : {}));
    return kept;
  };

  const wantedFor = async (provider: Provider) =>
    (await read())[provider.id] ?? provider.startingDefault;

  const providers = options.providers.map(
    (provider): Provider => ({
      ...provider,
      status: async (): Promise<ProviderStatus> => {
        const [status, wanted] = await Promise.all([provider.status(), wantedFor(provider)]);
        if (!status.available) return status;
        const chosen = usableDefault(status.models, wanted);
        return chosen === undefined ? status : { ...status, default: chosen };
      },
    }),
  );

  return {
    providers,
    /** Makes this model and effort its provider's default, once it's on offer and takes the effort. */
    save: async (
      providerId: string,
      chosen: ModelDefault,
    ): Promise<Result<ModelDefault, DefaultError>> => {
      const provider = providers.find((each) => each.id === providerId);
      if (provider === undefined) return err({ kind: "no-provider" });
      const status = await provider.status();
      const model = status.available
        ? status.models.find((each) => each.id === chosen.model)
        : undefined;
      if (model === undefined) return err({ kind: "not-offered", provider: status.label });
      if (!takesEffort(model, chosen.effort)) return err({ kind: "no-such-effort" });
      const defaults = { ...(await read()), [provider.id]: chosen };
      try {
        await mkdir(options.dataDir, { recursive: true });
      } catch {
        return err({ kind: "storage" });
      }
      const written = await writeJsonFile(file, defaults);
      if (!written.ok) return err({ kind: "storage" });
      kept = Promise.resolve(defaults);
      return ok(chosen);
    },
  };
};

export type ModelDefaults = ReturnType<typeof createModelDefaults>;
