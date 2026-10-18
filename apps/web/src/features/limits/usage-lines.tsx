import { ChevronRight } from "lucide-react";
import { OpenRow } from "@/components/code/build-stages";
import { useDock } from "@/components/frame/handheld";
import { CapsLabel } from "@/components/layout/caps-label";
import { useUsage } from "./api.ts";
import { resetsWords, warningWords } from "./words.ts";

/**
 * The warnings before a limit on a code workspace's Home (#66; Paper, "Tablet · Code Home: usage
 * line (#66)"), in the foot rows above Main: nothing while there's room; from 80%, one gold line
 * per provider, fullest first, at most two, each opening the Model sheet with its meters.
 */
export function UsageLines() {
  const usage = useUsage();
  const dock = useDock();
  const warnings = usage?.warnings ?? [];
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {warnings.map((warning) => {
        const words = warningWords(warning);
        const resets = resetsWords(warning.resetAt);
        return (
          <section
            key={warning.provider}
            aria-label="Usage"
            className="flex items-center rounded-bubble border border-warning/25 bg-surface py-3 pr-2.5 pl-3.5"
          >
            <OpenRow
              label={`${words}${resets === undefined ? "" : `, ${resets}`}: open the Model sheet`}
              onOpen={() => dock?.chooseModel()}
            >
              <CapsLabel tone="warning" inline className="shrink-0">
                Usage
              </CapsLabel>
              <span className="min-w-0 truncate text-meta font-bold text-foreground">{words}</span>
              {resets !== undefined && (
                <span className="min-w-0 flex-1 truncate text-meta font-medium text-warning">
                  {resets}
                </span>
              )}
              <ChevronRight
                aria-hidden
                strokeWidth={1.6}
                className="ml-auto size-4 shrink-0 text-muted-foreground"
              />
            </OpenRow>
          </section>
        );
      })}
    </div>
  );
}
