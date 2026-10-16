import type { LanguageFn } from "highlight.js";

type Grammar = () => Promise<{ default: LanguageFn }>;

/**
 * The languages a code block is coloured in: each one's name for the block's top bar, the other
 * names answers write after the fence, and its grammar, loaded the first time a block needs it.
 * A language not here is shown by its own name, uncoloured.
 */
const LANGUAGES: Record<string, { name: string; aliases?: readonly string[]; grammar: Grammar }> = {
  bash: {
    name: "Shell",
    aliases: ["sh", "shell", "zsh", "console"],
    grammar: () => import("highlight.js/lib/languages/bash"),
  },
  c: { name: "C", aliases: ["h"], grammar: () => import("highlight.js/lib/languages/c") },
  cpp: {
    name: "C++",
    aliases: ["c++", "cc", "hpp"],
    grammar: () => import("highlight.js/lib/languages/cpp"),
  },
  csharp: {
    name: "C#",
    aliases: ["cs", "c#"],
    grammar: () => import("highlight.js/lib/languages/csharp"),
  },
  css: { name: "CSS", grammar: () => import("highlight.js/lib/languages/css") },
  diff: {
    name: "Diff",
    aliases: ["patch"],
    grammar: () => import("highlight.js/lib/languages/diff"),
  },
  dockerfile: {
    name: "Dockerfile",
    aliases: ["docker"],
    grammar: () => import("highlight.js/lib/languages/dockerfile"),
  },
  excel: {
    name: "Excel",
    aliases: ["xls", "xlsx", "formula"],
    grammar: () => import("highlight.js/lib/languages/excel"),
  },
  go: { name: "Go", aliases: ["golang"], grammar: () => import("highlight.js/lib/languages/go") },
  graphql: {
    name: "GraphQL",
    aliases: ["gql"],
    grammar: () => import("highlight.js/lib/languages/graphql"),
  },
  ini: {
    name: "INI",
    aliases: ["toml", "conf", "cfg"],
    grammar: () => import("highlight.js/lib/languages/ini"),
  },
  java: { name: "Java", grammar: () => import("highlight.js/lib/languages/java") },
  javascript: {
    name: "JavaScript",
    aliases: ["js", "jsx", "mjs", "cjs"],
    grammar: () => import("highlight.js/lib/languages/javascript"),
  },
  json: {
    name: "JSON",
    aliases: ["jsonc", "json5"],
    grammar: () => import("highlight.js/lib/languages/json"),
  },
  kotlin: {
    name: "Kotlin",
    aliases: ["kt"],
    grammar: () => import("highlight.js/lib/languages/kotlin"),
  },
  lua: { name: "Lua", grammar: () => import("highlight.js/lib/languages/lua") },
  makefile: {
    name: "Makefile",
    aliases: ["make", "mk"],
    grammar: () => import("highlight.js/lib/languages/makefile"),
  },
  markdown: {
    name: "Markdown",
    aliases: ["md"],
    grammar: () => import("highlight.js/lib/languages/markdown"),
  },
  php: { name: "PHP", grammar: () => import("highlight.js/lib/languages/php") },
  powershell: {
    name: "PowerShell",
    aliases: ["ps", "ps1", "pwsh"],
    grammar: () => import("highlight.js/lib/languages/powershell"),
  },
  python: {
    name: "Python",
    aliases: ["py"],
    grammar: () => import("highlight.js/lib/languages/python"),
  },
  r: { name: "R", grammar: () => import("highlight.js/lib/languages/r") },
  ruby: { name: "Ruby", aliases: ["rb"], grammar: () => import("highlight.js/lib/languages/ruby") },
  rust: { name: "Rust", aliases: ["rs"], grammar: () => import("highlight.js/lib/languages/rust") },
  scss: { name: "SCSS", grammar: () => import("highlight.js/lib/languages/scss") },
  sql: { name: "SQL", grammar: () => import("highlight.js/lib/languages/sql") },
  swift: { name: "Swift", grammar: () => import("highlight.js/lib/languages/swift") },
  typescript: {
    name: "TypeScript",
    aliases: ["ts", "tsx", "mts", "cts"],
    grammar: () => import("highlight.js/lib/languages/typescript"),
  },
  xml: {
    name: "HTML",
    aliases: ["html", "svg", "xhtml"],
    grammar: () => import("highlight.js/lib/languages/xml"),
  },
  yaml: {
    name: "YAML",
    aliases: ["yml"],
    grammar: () => import("highlight.js/lib/languages/yaml"),
  },
};

const BY_NAME = new Map(
  Object.entries(LANGUAGES).flatMap(([id, language]) =>
    [id, ...(language.aliases ?? [])].map((name) => [name, { id, ...language }] as const),
  ),
);

/** A code block's language, from what's written after its fence ("py", "Python", "ts"). */
export const codeLanguage = (written: string | undefined) => {
  if (written === undefined || written === "") return undefined;
  const known = BY_NAME.get(written.toLowerCase());
  return known ?? { id: undefined, name: written, grammar: undefined };
};

export type CodeLanguage = NonNullable<ReturnType<typeof codeLanguage>>;
