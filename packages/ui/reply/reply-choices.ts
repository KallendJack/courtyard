import type { SkillName, SkillSummary } from "@courtyard/contract";
import type { ModelChoice } from "./model-pickers.tsx";
import type { OfferedModel } from "./models.ts";

/**
 * What the Handheld frame's Skills and Model buttons open for the Reply box (#194, #201). Each app
 * gives its own, loaded lazily with the box: making a model the default talks to the worker.
 */
export type ReplyChoices = {
  choosing: "model" | "skill" | undefined;
  close: () => void;
  /** Opens the Model sheet in place of the Skills sheet. */
  changeModel: () => void;
  models: readonly OfferedModel[];
  choice: ModelChoice;
  /** The workspace's name and the skills its picker lists, when it has any. */
  skills: { readonly workspaceName: string; readonly list: readonly SkillSummary[] } | undefined;
  /** The skill the message starts, if one is picked. */
  skill: SkillName | undefined;
  pick: (name: SkillName) => void;
};
