import { parse } from "acorn";

/**
 * JavaScript given on the line (`node -e`, #747), read with a parser (acorn) rather than by its
 * words, so comments, regular expressions and markup in its strings are read as what they are:
 * the text of its strings, the only place it names a path, and whether its names, members and
 * calls could run another program, reach the network or load code it works out (#730). Still a
 * check of what the code says, not of what it does (ADR 0038).
 */

/** What JavaScript says, as `readJavaScript` reads it. */
export type JavaScriptRead = {
  /** The text of each of its strings: literals, templates' fixed parts, literals joined by `+`. */
  readonly strings: readonly string[];
  /** It could run another program, reach the network or load code it can't be read for. */
  readonly runs: boolean;
  /** It names a folder outside the worktree by the function that gives it (`os.homedir()`). */
  readonly reachesOut: boolean;
};

/** A node of the parsed code, any kind, by what all of them have. */
type Tree = { readonly type: string; readonly start: number; readonly end: number };

const isTree = (value: unknown): value is Tree =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

/** A node's own field, as whatever it holds. */
const field = (node: Tree, name: string): unknown =>
  (node as unknown as Record<string, unknown>)[name];

/** A node's field that holds a node, or `undefined`. */
const child = (node: Tree, name: string) => {
  const value = field(node, name);
  return isTree(value) ? value : undefined;
};

/** A node's field that holds nodes. */
const children = (node: Tree, name: string) => {
  const value = field(node, name);
  return Array.isArray(value) ? value.filter(isTree) : [];
};

/** An identifier's name, or `undefined` for any other node. */
const nameOf = (node: Tree | undefined) =>
  node?.type === "Identifier" ? String(field(node, "name")) : undefined;

/** A template's fixed part, as it reads (its raw text where an escape in it doesn't). */
const templateText = (part: Tree) => {
  const value = field(part, "value");
  if (typeof value !== "object" || value === null) return "";
  const cooked = "cooked" in value ? value.cooked : undefined;
  const raw = "raw" in value ? value.raw : undefined;
  return typeof cooked === "string" ? cooked : typeof raw === "string" ? raw : "";
};

/**
 * A node's text when the code fixes it: a string, a number, a template without expressions, or
 * those joined by `+` (`'child_' + 'process'`), so a name or path spelled in parts reads whole.
 */
const fixedText = (node: Tree | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (node.type === "Literal") {
    const value = field(node, "value");
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  }
  if (node.type === "TemplateLiteral" && children(node, "expressions").length === 0)
    return children(node, "quasis").map(templateText).join("");
  if (node.type === "BinaryExpression" && field(node, "operator") === "+") {
    const [left, right] = [fixedText(child(node, "left")), fixedText(child(node, "right"))];
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
};

/** The name a member reads, `x.name` or `x["name"]`; `undefined` for one worked out (`x[key]`). */
const memberName = (member: Tree) =>
  field(member, "computed") === true
    ? fixedText(child(member, "property"))
    : nameOf(child(member, "property"));

/**
 * Names that run or load code, reach the global object or the network, wherever they're named:
 * `eval`, `Function` and `constructor` (`[].constructor.constructor(…)`), `Reflect`, the global
 * object, node's own loaders and bindings, Bun's and Deno's own calls, `fetch` and sockets, and
 * workers. `require` and `process` count as a member's name (`module.require`, `this.process`).
 */
const RUNS_NAMES = new Set([
  ...["eval", "Function", "constructor", "Reflect", "globalThis", "global", "self", "window"],
  ...["require", "process", "createRequire", "dlopen", "_linkedBinding", "getBuiltinModule"],
  ...["mainModule", "execve", "Bun", "Deno", "Worker", "SharedWorker"],
  ...["fetch", "WebSocket", "XMLHttpRequest", "EventSource"],
]);

/** Of those, the ones a string that is nothing but the name counts for: a member reached by it. */
const RUNS_STRINGS = new Set([
  ...["eval", "Function", "constructor", "require", "createRequire", "dlopen", "binding"],
  ...["_linkedBinding", "getBuiltinModule", "mainModule"],
]);

/** A name that runs a program: `spawn`, `fork` and `exec`'s kinds (`execSync`, `spawnSync`). */
const RUNS_PROGRAM = /spawn|fork|exec/i;

/** Process's members that load native code, reach node's bindings, the environment or others. */
const PROCESS_RUNS = new Set([
  ...["binding", "_linkedBinding", "dlopen", "getBuiltinModule", "mainModule", "env", "kill"],
  "execve",
]);

/** What a member worked out (`x[key]`) may not be read on: the global object, node's loaders. */
const WORKED_OUT_ON = new Set([
  ...["globalThis", "global", "self", "window", "this", "process", "module", "require"],
]);

/** Functions that give a folder outside the worktree: the home folder, the temporary one, node's. */
const OUTSIDE_NAMES = new Set(["homedir", "tmpdir", "userInfo", "execPath"]);

/**
 * Node's modules that run another program, reach the network or load code (`child_process`,
 * `net`, `vm`, `module`), with or without `node:`, or a module of theirs (`child_process/x`).
 */
const RUNS_MODULES = new Set([
  ...["child_process", "worker_threads", "cluster", "net", "http", "https", "http2", "dgram"],
  ...["tls", "dns", "inspector", "vm", "module", "process", "repl", "v8", "zx", "bun"],
]);

/**
 * Whether a module loaded by name could run another program, reach the network or load code: one
 * of node's above, one from elsewhere by its scheme (`https:`, `npm:`, `bun:`), or a package for
 * running programs by its name (`execa`, `cross-spawn`, `shelljs`).
 */
const runsModule = (module: string) => {
  const name = module.replace(/^node:/, "");
  return (
    /^[a-z][\w+.-]*:/i.test(name) ||
    RUNS_MODULES.has(name.split("/")[0] ?? "") ||
    /spawn|fork|exec|shell/i.test(name)
  );
};

/** Whether a call or import loads a module named in one string that doesn't run others. */
const loadsPlainly = (source: Tree | undefined) => {
  if (source?.type !== "Literal") return false;
  const module = field(source, "value");
  return typeof module === "string" && !runsModule(module);
};

/** Whether a call is `require('<module>')`, one string naming a module that doesn't run others. */
const requiresPlainly = (call: Tree) => {
  const args = children(call, "arguments");
  return args.length === 1 && loadsPlainly(args[0]);
};

/** What reading the code has found so far. */
type Found = { strings: string[]; runs: boolean; reachesOut: boolean };

/**
 * Whether a name runs others or reaches out, into what's found. A member named `exec` alone is a
 * regular expression's (`/x/.exec(text)`); `child_process`'s is caught where it's loaded.
 */
const readName = (found: Found, name: string, member: boolean) => {
  const regexExec = member && name === "exec";
  if (RUNS_NAMES.has(name) || (RUNS_PROGRAM.test(name) && !regexExec)) found.runs = true;
  if (OUTSIDE_NAMES.has(name)) found.reachesOut = true;
};

/**
 * Whether `require` or `process` stands where it's fine: `require` only called with one plain
 * module (`requiresPlainly`), `process` only read a member of by its name (`process.argv`), never
 * one in `PROCESS_RUNS`. `undefined` for any other name, which `readName` reads.
 */
const standsPlainly = (name: string, parent: Tree | undefined, key: string) => {
  if (name === "require")
    return parent?.type === "CallExpression" && key === "callee" && requiresPlainly(parent);
  if (name === "process")
    return (
      parent?.type === "MemberExpression" &&
      key === "object" &&
      field(parent, "computed") !== true &&
      !PROCESS_RUNS.has(memberName(parent) ?? "")
    );
  return undefined;
};

/** Reads a node and all it holds into what's found, by its kind. */
const readTree = (code: string, found: Found, node: Tree, parent?: Tree, key = "") => {
  // Text joined from parts (`'/et' + 'c'`) is read whole too.
  const joined = node.type === "BinaryExpression" ? fixedText(node) : undefined;
  if (joined !== undefined) {
    found.strings.push(joined);
    if (RUNS_STRINGS.has(joined)) found.runs = true;
  }
  switch (node.type) {
    case "Literal": {
      const value = field(node, "value");
      if (typeof value === "string") {
        found.strings.push(value);
        if (RUNS_STRINGS.has(value)) found.runs = true;
      }
      break;
    }
    case "TemplateElement":
      found.strings.push(templateText(node));
      break;
    case "Identifier": {
      const name = nameOf(node) ?? "";
      // A name spelled with escapes (`eval`) is one written not to be read.
      if (code.slice(node.start, node.end).includes("\\")) found.runs = true;
      const plain = standsPlainly(name, parent, key);
      if (plain === false) found.runs = true;
      if (plain === undefined)
        readName(found, name, parent?.type === "MemberExpression" && key === "property");
      break;
    }
    case "MemberExpression": {
      if (field(node, "computed") !== true) break;
      const name = memberName(node);
      const object = child(node, "object");
      const on = object?.type === "ThisExpression" ? "this" : (nameOf(object) ?? "");
      if (name === undefined && WORKED_OUT_ON.has(on)) found.runs = true;
      if (name !== undefined) readName(found, name, true);
      break;
    }
    case "CallExpression":
    case "NewExpression": {
      // A timer given code as text runs it (Deno's, a browser's), never only a function.
      const callee = nameOf(child(node, "callee"));
      const [first] = children(node, "arguments");
      const asText = /^(?:Literal|TemplateLiteral|BinaryExpression)$/.test(first?.type ?? "");
      if ((callee === "setTimeout" || callee === "setInterval") && asText) found.runs = true;
      break;
    }
    case "ImportExpression":
    case "ImportDeclaration":
    case "ExportAllDeclaration":
      if (!loadsPlainly(child(node, "source"))) found.runs = true;
      break;
    case "ExportNamedDeclaration":
      if (child(node, "source") !== undefined && !loadsPlainly(child(node, "source")))
        found.runs = true;
      break;
    case "WithStatement":
      found.runs = true;
      break;
  }
  for (const [name, value] of Object.entries(node)) {
    for (const each of Array.isArray(value) ? value : [value])
      if (isTree(each)) readTree(code, found, each, node, name);
  }
};

/** Code parsed as a script (as node runs `-e`) or as a module (with `import`), or `undefined`. */
const parsed = (code: string, sourceType: "script" | "module") => {
  try {
    return parse(code, {
      ecmaVersion: "latest",
      sourceType,
      allowHashBang: true,
      allowReturnOutsideFunction: sourceType === "script",
    });
  } catch {
    return undefined;
  }
};

/**
 * JavaScript given on the line, read both ways a runtime could take it, a script and a module,
 * each way it parses counted; `undefined` for code that parses neither way, which always asks.
 */
export const readJavaScript = (code: string): JavaScriptRead | undefined => {
  const trees = [parsed(code, "script"), parsed(code, "module")].filter(
    (tree) => tree !== undefined,
  );
  if (trees.length === 0) return undefined;
  const found: Found = { strings: [], runs: false, reachesOut: false };
  for (const tree of trees) readTree(code, found, tree);
  return found;
};
