import { useDock } from "@courtyard/ui/frame/handheld.ts";
import { ChevronRight } from "lucide-react";
import { OpenRow } from "@/components/code/build-stages";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { useUsage } from "./api.ts";
import { usageLineWords } from "./words.ts";

/**
 * The warnings before a limit on a code workspace's Home (#66; Paper, "Tablet · Code Home: one
 * usage line (#646)"), in the foot rows above Main: nothing while there's room; from 80%, one gold
 * row whatever the providers, opening the Model sheet with their meters. The fullest leads, in
 * bold with when it's back; the others follow, quiet, and are cut first when the row is short.
 */
export function UsageLines() {
  const usage = useUsage();
  const dock = useDock();
  const warnings = [...(usage?.warnings ?? [])].sort((one, other) => other.used - one.used);
  const [first, ...others] = warnings;
  if (first === undefined) return null;
  const lead = usageLineWords(first, { reset: true });
  const rest = others.map((warning) => `· ${usageLineWords(warning, { reset: false })}`).join(" ");
  return (
    <section
      aria-label="Usage"
      className="flex items-center rounded-bubble border border-warning/25 bg-surface py-3 pr-2.5 pl-3.5"
    >
      <OpenRow
        label={`${[lead, rest].join(" ").trim()}: open the Model sheet`}
        onOpen={() => dock?.chooseModel()}
      >
        <CapsLabel tone="warning" inline className="shrink-0">
          Usage
        </CapsLabel>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="max-w-full shrink-0 truncate text-meta font-bold text-foreground">
            {lead}
          </span>
          {rest !== "" && (
            <span className="min-w-0 truncate text-meta font-medium text-muted-foreground">
              {rest}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          strokeWidth={1.6}
          className="ml-auto size-4 shrink-0 text-muted-foreground"
        />
      </OpenRow>
    </section>
  );
}
