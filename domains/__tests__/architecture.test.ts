import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * `domains/**`'s OWN architectural test — a real, deliberate M6 addition,
 * not part of any frozen milestone's own boundary. `.genesis/decisions
 * /0005-domains.md` records the "should M6 add one" decision in full;
 * this header states the conclusion.
 *
 * WHY THIS EXISTS AT ALL, GIVEN `lib/simulate/**` ALREADY HAS ONE: ADR
 * 0002 (`adapter.ts`'s own header) names the gap by construction, not as
 * a hypothetical: `SimulationAdapter.project` being synchronous closes
 * every path that needs an in-`project()` `await`, but ESM top-level
 * `await` — run once at MODULE INITIALIZATION, before `project()` is ever
 * called — prefetches a real network/LLM response and still type-checks,
 * still passes `simulate()` cleanly. `lib/simulate/__tests__
 * /architecture.test.ts`'s own grep-based guard CANNOT see this, by its
 * own frozen scan boundary: it only ever reads files under `lib/simulate
 * /**`, and a real domain adapter's module lives in `domains/**` — a
 * directory that guard has never scanned and, being frozen, never will.
 * ADR 0002 states this in exactly those words as a "genuine, unresolved
 * gap for M6 to inherit." This file is M6 closing it, for its own
 * directory, the only directory positioned to.
 *
 * TWO CHECKS, MIRRORING `lib/simulate`'s OWN GUARD'S SHAPE (an allowlist
 * over a denylist, for the identical reason that file's header argues at
 * length — not re-argued here):
 *
 *   1. Every import/require specifier in non-test source under
 *      `domains/**` must be relative AND resolve (both textually and
 *      after following any symlink — see `resolvesToRealAllowedPath`
 *      below, copied from `lib/simulate`'s own fix history rather than
 *      re-derived, since the exploit it closes is identical) inside one
 *      of: `domains/` itself, or one of the four frozen `lib/**`
 *      directories this milestone is allowed to depend on
 *      (`contracts`/`simulate`/`reconcile`/`rollback`). This closes the
 *      network/LLM-client/Node-builtin import path exactly the way
 *      `lib/simulate`'s guard does, scoped to this directory instead.
 *   2. No non-test source file under `domains/**` contains the bare
 *      keyword `await`, anywhere — not just at module top level. See
 *      below for why banning it EVERYWHERE, not only outside a function
 *      body, is the correct rule for this specific milestone's domains
 *      (a scoping choice, stated honestly, not a general-purpose
 *      top-level-vs-nested-await parser this file does not attempt to
 *      write).
 *
 * WHY BAN `await` OUTRIGHT, NOT JUST AT TOP LEVEL: every function this
 * milestone's `DomainAdapter` interface (`domains/types.ts`) requires —
 * `project`, `applyReal`, `proposeRollback` — is typed and used
 * synchronously; none of this milestone's real domain code has any
 * legitimate reason to be `async` at all, at any nesting depth. Given
 * that, `await` appearing ANYWHERE in `domains/**` non-test source is
 * either (a) the exact top-level-prefetch attack ADR 0002 names, or (b)
 * a domain function that has quietly become `async`, which would ALSO
 * defeat `SimulationAdapter.project`'s required synchronous signature
 * the moment it were wired into `simulate()` — so there is no legitimate
 * case this blanket rule would wrongly reject, for the code this
 * milestone actually ships. Distinguishing "top-level" from "inside a
 * function" would need a real parser (tracking function-body nesting
 * precisely, including arrow functions, methods, and generators) that
 * this file does not attempt to write; the blanket rule is simpler,
 * TODAY'S provably-sufficient version of the same protection, and this
 * paragraph says so rather than silently narrowing scope.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const DOMAINS_ROOT = join(REPO_ROOT, "domains");
const ALLOWED_ROOTS: readonly string[] = [
  DOMAINS_ROOT,
  join(REPO_ROOT, "lib", "contracts"),
  join(REPO_ROOT, "lib", "simulate"),
  join(REPO_ROOT, "lib", "reconcile"),
  join(REPO_ROOT, "lib", "rollback"),
];
const REAL_ALLOWED_ROOTS: readonly string[] = ALLOWED_ROOTS.map((root) => realpathSync(root));

function listNonTestSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "__tests__") continue; // this test's own fixtures/specs are exempt — this invariant is about the shipped domains, not their own test suite.
      files.push(...listNonTestSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

interface FoundSpecifier {
  readonly specifier: string;
  readonly line: number;
}

interface FoundAwait {
  readonly line: number;
}

const SPECIFIER_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*$/,
  /\bimport\s*$/,
  /\bimport\s*\(\s*$/,
  /\brequire\s*\(\s*$/,
];

function isSpecifierContext(codeTail: string): boolean {
  return SPECIFIER_CONTEXT_PATTERNS.some((pattern) => pattern.test(codeTail));
}

/** True only for a genuine, standalone `await` keyword — not `awaited`, not `myAwait`, not `obj.await`. */
const BARE_AWAIT_TAIL = /(?<![.\w$])await$/;

/**
 * Tokenizes `source` the same way `lib/simulate/__tests__
 * /architecture.test.ts` does (comments and string/template-literal
 * CONTENTS are opaque spans, never re-scanned) — copied rather than
 * re-derived, since the false-positive hazards it guards against
 * (Prettier-wrapped multi-line imports, a comment merely MENTIONING
 * `await`) are identical here. Extended to watch for a bare `await`
 * keyword instead of a bare `fetch(` call — this file has no analogous
 * "no import needed" ambient global to worry about for imports (that
 * concern is specific to `fetch`), but `await` is a KEYWORD, not a call,
 * so it is checked on every non-identifier character, not only `(`.
 */
function tokenize(source: string): { specifiers: readonly FoundSpecifier[]; awaits: readonly FoundAwait[] } {
  const specifiers: FoundSpecifier[] = [];
  const awaits: FoundAwait[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let codeTail = "";

  const flushAwaitCheck = () => {
    if (BARE_AWAIT_TAIL.test(codeTail)) awaits.push({ line });
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      codeTail = "";
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      codeTail = "";
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const startLine = line;
      const specifierPosition = isSpecifierContext(codeTail);

      let content = "";
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          content += source[i] + (source[i + 1] ?? "");
          if (source[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (source[i] === "\n") line++;
        content += source[i];
        i++;
      }
      i++;

      if (specifierPosition && !content.includes("${")) {
        specifiers.push({ specifier: content, line: startLine });
      }

      codeTail = "";
      continue;
    }

    // `await` is a keyword, so it is checked at every boundary — the
    // instant a non-identifier character follows it (whitespace,
    // punctuation, EOF) — rather than only on a specific trigger
    // character the way `fetch(` (a call) is checked only on `(`.
    if (!/[\w$]/.test(c ?? "")) flushAwaitCheck();

    if (c === "\n") line++;
    codeTail = (codeTail + c).slice(-60);
    i++;
  }
  flushAwaitCheck(); // EOF immediately after `await` with no trailing character at all.

  return { specifiers, awaits };
}

function isRealPathContained(candidate: string): boolean {
  return REAL_ALLOWED_ROOTS.some((root) => candidate === root || candidate.startsWith(root + sep));
}

function resolvesToRealAllowedPath(resolved: string): boolean {
  try {
    return isRealPathContained(realpathSync(resolved));
  } catch {
    // Falls through to the directory-level attempt below.
  }
  try {
    return isRealPathContained(realpathSync(dirname(resolved)));
  } catch {
    return false; // FAIL CLOSED: neither the leaf nor its enclosing directory resolves to anything real.
  }
}

function resolvesInsideAllowedRoots(fromFile: string, specifier: string): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false;
  const resolved = resolve(dirname(fromFile), specifier);
  const textuallyContained = ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + sep));
  if (!textuallyContained) return false;
  return resolvesToRealAllowedPath(resolved);
}

interface SpecifierOffender {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
}
interface AwaitOffender {
  readonly file: string;
  readonly line: number;
}

function scan(): { specifierOffenders: SpecifierOffender[]; awaitOffenders: AwaitOffender[] } {
  const specifierOffenders: SpecifierOffender[] = [];
  const awaitOffenders: AwaitOffender[] = [];
  for (const file of listNonTestSourceFiles(DOMAINS_ROOT)) {
    const source = readFileSync(file, "utf8");
    const { specifiers, awaits } = tokenize(source);
    for (const { specifier, line } of specifiers) {
      if (!resolvesInsideAllowedRoots(file, specifier)) {
        specifierOffenders.push({ file: relative(REPO_ROOT, file), line, specifier });
      }
    }
    for (const { line } of awaits) {
      awaitOffenders.push({ file: relative(REPO_ROOT, file), line });
    }
  }
  return { specifierOffenders, awaitOffenders };
}

describe("domains/** never reaches an LLM, the network, or a Node built-in, and never contains `await`", () => {
  it("every import/require specifier in non-test source is relative AND resolves inside domains/ or one of the four allowed lib/** roots", () => {
    const { specifierOffenders } = scan();
    if (specifierOffenders.length > 0) {
      const report = specifierOffenders.map((o) => `${o.file}:${o.line}: imports "${o.specifier}"`).join("\n");
      throw new Error(
        `domains/** may only import a specifier that resolves inside domains/, lib/contracts/, lib/simulate/, ` +
          `lib/reconcile/, or lib/rollback/ — found ${specifierOffenders.length} offending import(s):\n${report}`,
      );
    }
    expect(specifierOffenders).toEqual([]);
  });

  it("no non-test source file under domains/** contains the bare keyword `await`, anywhere (see file header for why blanket, not top-level-only)", () => {
    const { awaitOffenders } = scan();
    if (awaitOffenders.length > 0) {
      const report = awaitOffenders.map((o) => `${o.file}:${o.line}`).join("\n");
      throw new Error(
        `domains/** may never contain the keyword "await" — every DomainAdapter function is required to be ` +
          `synchronous, and this is exactly the ESM top-level-await prefetch path ADR 0002 names as a real, ` +
          `unresolved gap for M6 to close. Found ${awaitOffenders.length} occurrence(s):\n${report}`,
      );
    }
    expect(awaitOffenders).toEqual([]);
  });

  describe("false-positive discipline — this test does not flag its own sanity-test strings", () => {
    it("a relative import of a local helper does not get flagged as an await/fetch-style false positive", () => {
      const { specifiers } = tokenize(`import { netDeltas } from "../shared/net.js";\n`);
      expect(specifiers).toEqual([{ specifier: "../shared/net.js", line: 1 }]);
    });

    it("a comment or string merely mentioning 'await' is not flagged", () => {
      const source = [
        `// this comment mentions await but is not one`,
        `const s = "please await nothing here";`,
        `const awaited = 1;`,
        `const myAwaitHelper = () => 1;`,
      ].join("\n");
      const { awaits } = tokenize(source);
      expect(awaits).toEqual([]);
    });

    it("a genuine bare `await` keyword IS flagged, proving this test has teeth", () => {
      const { awaits } = tokenize(`async function f() {\n  const x = await Promise.resolve(1);\n  return x;\n}\n`);
      expect(awaits.length).toBe(1);
      expect(awaits[0]?.line).toBe(2);
    });

    it("a specifier resolving outside every allowed root IS flagged, proving this test has teeth", () => {
      const fromFile = join(DOMAINS_ROOT, "calendar", "domain.ts");
      expect(resolvesInsideAllowedRoots(fromFile, "../../node_modules/next/package.json")).toBe(false);
      expect(resolvesInsideAllowedRoots(fromFile, "openai")).toBe(false);
      expect(resolvesInsideAllowedRoots(fromFile, "node:fs")).toBe(false);
    });

    it("a genuine, legitimate domains/** or lib/** relative import IS accepted", () => {
      const fromFile = join(DOMAINS_ROOT, "calendar", "domain.ts");
      expect(resolvesInsideAllowedRoots(fromFile, "../../lib/rollback/index.js")).toBe(true);
      expect(resolvesInsideAllowedRoots(fromFile, "../shared/net.js")).toBe(true);
      expect(resolvesInsideAllowedRoots(fromFile, "../../lib/simulate/index.js")).toBe(true);
    });
  });
});
