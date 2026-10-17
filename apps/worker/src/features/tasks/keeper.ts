// Keeps one task (#182): runs its command through the shell, its output going where this one's
// does (the task's file in the data folder), and ends the command's whole process tree when the
// worker says "stop", or when the worker itself goes, which closes this one's input. So no task
// outlives the worker, however it stopped (an Update, a crash). Ends with the command's exit code.
//
//   node keeper.ts <word> [more words]

import { spawn } from "node:child_process";
import { endProcessTree } from "../../lib/commands.ts";

const words = process.argv.slice(2);
const windows = process.platform === "win32";

/** A word as the shell reads it back as itself. */
const quoted = (word: string) => {
  if (/^[\w@+=:,./-]+$/.test(word)) return word;
  return windows ? `"${word.replaceAll('"', '\\"')}"` : `'${word.replaceAll("'", "'\\''")}'`;
};

const child = spawn(words.map(quoted).join(" "), {
  shell: true,
  stdio: ["ignore", "inherit", "inherit"],
  // Its own process group, so the whole tree can be ended at once.
  detached: !windows,
  windowsHide: true,
});

let ending = false;
/** Ends the command and everything it started. */
const endTree = () => {
  const { pid } = child;
  if (ending || pid === undefined || child.exitCode !== null) return;
  ending = true;
  endProcessTree(pid);
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (said: string) => {
  if (said.includes("stop")) endTree();
});
// The worker has gone.
process.stdin.on("end", endTree);
process.stdin.on("error", endTree);

child.on("error", (error) => {
  console.error(`Courtyard couldn't run it: ${error.message}`);
  process.exit(127);
});
child.on("exit", (code) => process.exit(code ?? 1));
