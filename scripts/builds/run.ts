// The machine's builds lock (#306), for the repo's own heavy checks: `verify`, `test`, `e2e` and
// `build` run through this, so a helper's checks and Courtyard's code sessions on the same machine
// take turns rather than lock it up together. It waits for a place in the lock (saying who holds
// it and since when), runs the command with `COURTYARD_BUILD_HELD=1`, so the checks it runs
// itself (`verify` running `e2e`) go straight through, and frees the place however the command
// ends. A run that sees `COURTYARD_BUILD_HELD=1`, as a Courtyard session's commands do once the
// worker has given its build a place, goes straight through too.
//
//   node scripts/builds/run.ts "<command>" [more arguments, passed on]
//
// COURTYARD_BUILDS_AT_ONCE says how many places there are (1 unless set), as it does for the
// worker; COURTYARD_BUILDS_LOCK_DIR moves the lock, which only tests do.

import { spawn } from "node:child_process";
import { constants } from "node:os";
import {
  BuildsSettings,
  buildsLockOf,
  HELD_ENV,
  type Holder,
  type Place,
  placeHeldIn,
  takePlace,
} from "../../packages/builds/index.ts";

const [command, ...more] = process.argv.slice(2);
if (command === undefined || command.trim() === "") {
  console.error('Say what to run: node scripts/builds/run.ts "<command>" [more arguments]');
  process.exit(1);
}

/** An argument passed on through the shell as it was given. */
const quoted = (argument: string) =>
  /^[\w@%+=:,./-]+$/.test(argument) ? argument : `"${argument.replaceAll('"', '\\"')}"`;

const time = (date: Date) => date.toTimeString().slice(0, 5);
const said = (holder: Holder) => `${holder.label} has had it since ${time(holder.since)}`;

let place: Place | null = null;
if (!placeHeldIn(process.env)) {
  const settings = BuildsSettings.safeParse(process.env);
  if (!settings.success) {
    for (const issue of settings.error.issues) {
      console.error(`${issue.path.join(".")} ${issue.message}`);
    }
    process.exit(1);
  }
  place = await takePlace(buildsLockOf(settings.data), {
    label: `helper ${process.cwd()}`,
    waiting: (holders) =>
      console.log(`Waiting for the machine's builds lock: ${holders.map(said).join("; ")}.`),
  });
}

const child = spawn([command, ...more.map(quoted)].join(" "), {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, ...HELD_ENV },
});
// However this ends, the place is freed: when the command ends, and when this is told to stop.
process.on("exit", () => place?.free());
// Ctrl+C reaches the command too: this waits for it to end, then frees the place.
process.on("SIGINT", () => {});
for (const signal of ["SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`Couldn't run ${command}: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal === null ? 1 : 128 + constants.signals[signal]));
});
