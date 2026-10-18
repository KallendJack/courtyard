import { z } from "zod";
import { ModelRef, ProviderId } from "./session.ts";

/**
 * Usage at a glance (#66): how much of each provider's plan limits is used, and the warning
 * before one is reached. The worker reads them from each provider and decides the warning; the
 * web app only shows them.
 */

/** From this much of a window used, it warns (gold), once a turn could stop on it. */
export const USAGE_WARNS_AT = 80;
/** Past this much, a warning the owner put off with Not now comes back, once. */
export const USAGE_WARNS_AGAIN_AT = 95;
/** A reading older than this says when it was read ("as of 10:42"). */
export const USAGE_READING_OLD_MS = 60 * 60 * 1000;

/** The two plan windows every provider is shown with: the 5-hour one and the weekly one. */
export const UsageWindow = z.enum(["five-hour", "weekly"]);
export type UsageWindow = z.infer<typeof UsageWindow>;

/** One window's meter: how much of it is used, in percent, and when it resets. */
export const UsageMeter = z.object({
  window: UsageWindow,
  /** Percent of the window used, 0 to 100; `null` while it isn't known yet, never a guess. */
  used: z.number().min(0).nullable(),
  resetAt: z.iso.datetime().optional(),
});
export type UsageMeter = z.infer<typeof UsageMeter>;

/**
 * A weekly limit of one family of models (Opus, Sonnet), named as the provider names it. Shown
 * only under that model in the Model sheet, and only once it's past `USAGE_WARNS_AT`.
 */
export const ModelUsageMeter = z.object({
  /** The family's name, which the model's own name starts with: "Opus". */
  name: z.string().min(1),
  used: z.number().min(0),
  resetAt: z.iso.datetime().optional(),
});
export type ModelUsageMeter = z.infer<typeof ModelUsageMeter>;

/**
 * A provider's plan usage: its 5-hour and weekly meters, in that order, and its models' own
 * weekly ones, with when it was last read; or none, for a provider not signed in or a sign-in
 * with no plan limits (an API key).
 */
export const PlanUsage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no-plan") }),
  z.object({
    kind: z.literal("plan"),
    meters: z.array(UsageMeter),
    models: z.array(ModelUsageMeter),
    /** When anything of it was last heard, for "as of 10:42" once that's over an hour ago. */
    readAt: z.iso.datetime().optional(),
  }),
]);
export type PlanUsage = z.infer<typeof PlanUsage>;

/** One provider's plan usage, by its id and name. */
export const ProviderUsage = z.object({
  provider: ProviderId,
  label: z.string(),
  usage: PlanUsage,
});
export type ProviderUsage = z.infer<typeof ProviderUsage>;

/**
 * The warning before a provider's limit (#66), decided by the worker: its fullest window, past
 * `USAGE_WARNS_AT`, and where a session could switch to before a turn stops on it.
 */
export const UsageWarning = z.object({
  provider: ProviderId,
  label: z.string(),
  window: UsageWindow,
  used: z.number().min(0),
  resetAt: z.iso.datetime().optional(),
  /**
   * Another provider that's connected and not at its limit, with its default model, which Switch
   * sends the next message to; with its own fullest window when that's past `USAGE_WARNS_AT` too.
   * Left out when there's none.
   */
  switchTo: z
    .object({
      label: z.string(),
      model: ModelRef,
      fullest: z.object({ window: UsageWindow, used: z.number().min(0) }).optional(),
    })
    .optional(),
});
export type UsageWarning = z.infer<typeof UsageWarning>;

/** `GET /api/usage`: every provider's plan usage, and the warnings, fullest first, at most two. */
export const UsageList = z.object({
  providers: z.array(ProviderUsage),
  warnings: z.array(UsageWarning),
});
export type UsageList = z.infer<typeof UsageList>;

/** `POST /api/usage/not-now`: puts off a provider's warning until its window resets. */
export const UsageNotNow = z.object({ provider: ProviderId });
export type UsageNotNow = z.infer<typeof UsageNotNow>;

/** A window as a few words say it: "this week", "5-hour". */
export const usageWindowWords = (window: UsageWindow) =>
  window === "weekly" ? "this week" : "the 5-hour window";
