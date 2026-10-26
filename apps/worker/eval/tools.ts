import { ToolsHeard, YourTools } from "@courtyard/contract";
import { postJson, type Requester } from "../test/testing.ts";
import type { ExpectedTool, Scenario, Words } from "./scenarios.ts";

// The owner's tools (#707, ADR 0037): kept at the owner's level, so a model in any workspace knows
// them without asking, and ticked on Your tools from what the owner said, saving nothing.

/** A tool of the owner's, as Your tools would have saved it. */
export const toolFile = (name: string, count?: number) =>
  `---\nname: ${name}\nstatus: have\nkind: tool\n${count === undefined ? "" : `count: ${count}\n`}---\n`;

/** Asking which tools the owner has, when they're known. */
const TOOLS_ASKED: readonly Words[] = [
  ["what tools"],
  ["which tools"],
  ["tools do you"],
  ["tools you have"],
  ["tools you've got"],
  ["tools you’ve got"],
];

export const TOOLS: readonly Scenario[] = [
  {
    name: "tools-owner-level",
    rule: "asked what tools the owner has, in a new workspace, a model names the owner's tools without asking (#707)",
    workspace: "Shed",
    context: {},
    ownerFiles: {
      "things/hand-saw.md": toolFile("Hand saw"),
      "things/workmate.md": toolFile("Workmate"),
      "things/clamps.md": toolFile("Clamps", 2),
    },
    turns: [
      {
        say: "Which of my tools will I need to cut some shelves for the shed?",
        expect: [],
        things: [],
        says: [["hand saw", "handsaw"], ["workmate"], ["clamp"]],
        avoids: TOOLS_ASKED,
      },
    ],
  },
  {
    name: "tools-heard",
    rule: 'told "a hand saw, the Workmate and two clamps", Or just say it ticks those three, clamps × 2, and saves nothing (#707)',
    workspace: "Shed",
    context: {},
    turns: [
      {
        say: "A hand saw, the Workmate and two clamps",
        expect: [],
        heardTools: [{ name: "Hand saw" }, { name: "Workmate" }, { name: "Clamps", count: 2 }],
      },
    ],
  },
];

/** A heard tool as a check reads it: its name in lower case, and how many. */
const described = ({ name, count }: { name: string; count?: number | undefined }) =>
  `${name.toLowerCase()}${count === undefined || count === 1 ? "" : ` × ${count}`}`;

/**
 * A turn said under "Or just say it": the tools a model ticked, exactly those expected, and none of
 * the owner's saved. Its checks and what it ticked.
 */
export const judgeHeardTools = async (judge: {
  request: Requester;
  said: string;
  expected: readonly ExpectedTool[];
}): Promise<{ checks: { miss: string | null }[]; notes: string[] }> => {
  const { request, said, expected } = judge;
  const response = await postJson(request, "/api/fabrication/tools/heard", { said });
  if (response.status !== 200) throw new Error(`hearing the tools failed (${response.status})`);
  const heard = ToolsHeard.parse(await response.json())
    .tools.map(described)
    .sort();
  const wanted = expected.map(described).sort();
  const none = !YourTools.parse(await (await request("/api/fabrication/tools")).json()).saved;
  return {
    checks: [
      {
        miss:
          JSON.stringify(heard) === JSON.stringify(wanted)
            ? null
            : `expected it to tick ${wanted.join(", ")}; it ticked ${heard.join(", ") || "nothing"}`,
      },
      { miss: none ? null : "it saved the owner's tools" },
    ],
    notes: [`ticked ${heard.join(", ") || "nothing"}`],
  };
};
