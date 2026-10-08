import { type FailureReason, overflowFrom, type ProviderList } from "@courtyard/contract";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form-error";
import { Notice } from "@/components/notice";
import { useAction } from "@/lib/use-action";
import type { Turn } from "./events.ts";
import { resetsWhen } from "./limits.ts";

type RateLimited = Extract<FailureReason, { kind: "rate-limited" }>;

/** When a provider's limit resets, as a sentence: "It resets Thursday at 14:00." */
const resets = (resetAt: string | undefined) =>
  resetAt === undefined ? "When it resets isn't known." : `It resets ${resetsWhen(resetAt)}.`;

/**
 * A turn that hit its provider's usage limit (spec, Overflow): when it resets, and for the last
 * turn the one way forward there is. Carry on with another provider when one has room; Go to sign
 * in when one is only signed out; when every other one is at its limit too, each reset time.
 * Nothing happens until the owner taps.
 */
export function LimitNotice(props: {
  turn: Turn;
  reason: RateLimited;
  providers: ProviderList["providers"];
  /** Carry on, for the session's last turn: an error to show, or nothing once it's on its way. */
  onCarryOn?: (turn: Turn) => Promise<string | undefined>;
}) {
  const { turn, reason, providers, onCarryOn } = props;
  const carry = useAction(async () => onCarryOn?.(turn));
  const limited = turn.model.provider;
  const label = providers.find((provider) => provider.id === limited)?.label ?? limited;
  const title = `${label}'s usage limit is reached`;
  const overflow = onCarryOn ? overflowFrom(providers, limited) : { kind: "none" as const };

  switch (overflow.kind) {
    case "carry-on":
      return (
        <Notice
          title={title}
          action={
            <Button size="sm" disabled={carry.busy} onClick={() => void carry.run()}>
              Carry on with {overflow.label}
            </Button>
          }
          {...(carry.error ? { footer: <FormError message={carry.error} /> } : {})}
        >
          {resets(reason.resetAt)}
        </Notice>
      );
    case "sign-in":
      return (
        <Notice
          title={title}
          action={
            <ButtonLink to="/" variant="outline" size="sm">
              Go to sign in
            </ButtonLink>
          }
        >
          {resets(reason.resetAt)} Sign in to {overflow.label} on the home page to carry on there.
        </Notice>
      );
    case "at-limit": {
      const all = [{ label, resetAt: reason.resetAt }, ...overflow.others];
      const names = all.map((provider) => provider.label);
      const when = all.map((provider, index) =>
        provider.resetAt === undefined
          ? `${provider.label}'s reset time isn't known`
          : `${provider.label} ${index === 0 ? "resets " : ""}${resetsWhen(provider.resetAt)}`,
      );
      const both = names.length === 2 ? "both " : "all ";
      return (
        <Notice
          title={`${names.slice(0, -1).join(", ")} and ${names.at(-1)} are ${both}at their limit`}
        >
          {when.join(", ")}.
        </Notice>
      );
    }
    case "none":
      return <Notice title={title}>{resets(reason.resetAt)}</Notice>;
  }
}
