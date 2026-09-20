import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, realpathSync, rmSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  isAwaitExpression,
  isCallExpression,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportExpression,
  isStringLiteralLikeNode,
  type Expression,
  type Node,
  type SourceFile,
} from "typescript/unstable/ast";
import { API, type Project } from "typescript/unstable/sync";

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
 * /architecture.test.ts`'s own guard CANNOT see this, by its own scan
 * boundary: it only ever reads files under `lib/simulate/**`, and a real
 * domain adapter's module lives in `domains/**` — a directory that guard
 * has never scanned. This file is M6 closing that gap, for its own
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
 *   2. No non-test source file under `domains/**` contains a bare
 *      `await` EXPRESSION, anywhere — not just at module top level. See
 *      "WHY BAN `await` OUTRIGHT" below for why banning it EVERYWHERE,
 *      not only outside a function body, is the DELIBERATE, KEPT choice
 *      for this specific milestone's domains, not a limitation this
 *      revision happens to remove — a real parser makes a genuine
 *      top-level-only check EASY (an `AwaitExpression` whose nearest
 *      enclosing function is the source file itself), and this file
 *      still does not narrow to that, on purpose, named plainly below.
 *
 * FIX HISTORY, PATH-CONTAINMENT SIDE (`resolvesInsideAllowedRoots`) —
 * copied from `lib/simulate/__tests__/architecture.test.ts`'s own two
 * rounds (a syntax-only allowlist missing that a relative specifier can
 * still resolve into `node_modules/`; a textual containment check missing
 * that a real symlink can point the same TEXTUAL path somewhere else
 * entirely once dereferenced) — see that file's header for the full
 * argument, not re-argued here. Neither round is reopened by this
 * revision.
 *
 * FIX HISTORY, HOW `await`/SPECIFIERS ARE FOUND AT ALL (the part THIS
 * revision replaces outright — copied from `lib/simulate/__tests__
 * /architecture.test.ts`'s identical history, since this file's checker
 * was copied from that one and inherited its exact gaps at every round):
 *
 *   - ROUNDS 1–3 (a hand-rolled tokenizer, later made re-entrant across
 *     `${...}` interpolations): closed a bypass where `` `${await
 *     fetch("https://example.com")}` `` hid a live `await` keyword inside
 *     what the tokenizer had been treating as one opaque backtick span.
 *   - ROUND 4 (independent verification — THE ONE THAT ENDED THE
 *     TOKENIZER, NOT JUST PATCHED IT, confirmed identically in THIS file
 *     as well as `lib/simulate`'s): a regex literal containing a
 *     backtick defeats round 3's fix completely, for the REST OF THE
 *     FILE, because the tokenizer has no concept of a regex literal:
 *
 *         const re = /`/;
 *         async function f() { await g(); }
 *
 *     The `` ` `` inside the regex is indistinguishable, to a tokenizer
 *     with no regex-literal handling, from the start of a template
 *     literal, so the scanner began hunting for a close backtick that
 *     never comes and swallowed the rest of the file — including a
 *     completely plain, unobfuscated `await` — as inert string content.
 *     Confirmed directly: `awaits: []` for the snippet above, versus
 *     `[{"line":2}]` for the same snippet with `const re = 1;` in its
 *     place. See `lib/simulate/__tests__/architecture.test.ts`'s header
 *     for the full argument for why the fix is deleting the tokenizer,
 *     not patching it a fourth time — not re-argued here.
 *
 * THE FIX: DELETE THE TOKENIZER. `tokenize`/`scanCode`/`scanTemplateBody`
 * are gone. This file now parses every file/snippet it inspects with the
 * REAL TypeScript compiler, identically to `lib/simulate/__tests__
 * /architecture.test.ts`'s own fix — `typescript/unstable/sync`'s `API`/
 * `Project`/`Program`, walked with `Node#forEachChild`. `analyzeFile`/
 * `analyzeSource` (below) replace `tokenize`; every existing test's
 * assertions are unchanged — only the mechanism changed, from text
 * scanning to compiling.
 *
 * WHAT COUNTS AS "A SPECIFIER" NOW: identical rule to `lib/simulate`'s
 * file — see that file's header for the precise cases (`ImportDeclaration`,
 * `ImportEqualsDeclaration`'s `ExternalModuleReference`, a dynamic
 * `import(...)` call via `isImportExpression`, a `require(...)` call), a
 * literal string/no-substitution-template argument recorded as-is, and a
 * NON-literal argument now recorded under its own raw source text so it
 * gets rejected for not looking relative — closing the same previously-
 * disclosed "dynamically computed specifier" gap this file's `lib/
 * simulate` sibling closes.
 *
 * WHAT COUNTS AS "A BARE `await`" NOW: an `AwaitExpression` node found
 * ANYWHERE in the AST — the direct, structural replacement for the old
 * `BARE_AWAIT_TAIL` regex, with the IDENTICAL scope (still blanket, still
 * not top-level-only — see "WHY BAN `await` OUTRIGHT" below for why that
 * choice is kept, not just inherited by omission).
 *
 * WHAT IS AND ISN'T CAUGHT NOW, STATED PLAINLY (see the "false-positive
 * discipline"/regression blocks below for the direct proof of each
 * claim):
 *   - CAUGHT: every case the old tokenizer's rounds 1–3 caught (`await`
 *     hidden inside a `${...}` interpolation at any nesting depth), PLUS
 *     the round-4 regex-literal bypass (a real parser never confuses a
 *     regex literal for a template literal), PLUS a dynamically-computed
 *     import specifier (previously undetectable, now flagged).
 *   - STILL NOT CAUGHT, BY DESIGN, NOT OVERSIGHT: any asynchrony that
 *     never spells the literal keyword `await` at all — a raw
 *     `.then(...)` chain, a generator-based coroutine, or a `Promise`
 *     used without ever awaiting it — and a keyword typed out only
 *     inside an ORDINARY string or comment meant for `eval` later.
 *     Strings and comments stay deliberately opaque as DATA; a real
 *     parser does not execute or re-interpret their contents. These are
 *     semantic gaps (the code never spells the forbidden keyword as code
 *     at all), not lexical ones — a real parser has no lexical/syntactic
 *     blind spots left for this file's scope.
 *
 * WHY BAN `await` OUTRIGHT, NOT JUST AT TOP LEVEL — KEPT DELIBERATELY,
 * NOW THAT A TOP-LEVEL-ONLY CHECK IS ACTUALLY EASY: with a real AST, "is
 * this `AwaitExpression`'s nearest enclosing function the source file
 * itself" is a short walk up `.parent` links — nothing like the "real
 * parser this file does not attempt to write" limitation the hand-rolled
 * tokenizer era's header cited for why the ban stayed blanket. It stays
 * blanket ANYWAY, on the merits, unchanged from that era's reasoning:
 * every function this milestone's `DomainAdapter` interface
 * (`domains/types.ts`) requires — `project`, `applyReal`,
 * `proposeRollback` — is typed and used synchronously; none of this
 * milestone's real domain code has any legitimate reason to be `async`
 * at all, at any nesting depth. Given that, `await` appearing ANYWHERE in
 * `domains/**` non-test source is either (a) the exact top-level-prefetch
 * attack ADR 0002 names, or (b) a domain function that has quietly
 * become `async`, which would ALSO defeat `SimulationAdapter.project`'s
 * required synchronous signature the moment it were wired into
 * `simulate()`. A top-level-only check would catch (a) and MISS (b)
 * entirely — narrowing scope now that the tooling makes it POSSIBLE would
 * be a real regression dressed up as a improvement, so this file keeps
 * the wider net it always had.
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

/**
 * ONE `API` instance for this whole file — see `lib/simulate/__tests__
 * /architecture.test.ts`'s identical setup for why (spawning the real
 * compiler's backing process once, in `beforeAll`, rather than per
 * assertion, keeps this file fast).
 */
let api: API;
beforeAll(() => {
  api = new API();
});
afterAll(() => {
  api.close();
});

/**
 * Parses `file` with the real compiler and extracts exactly the two
 * things this file cares about — see the file header's "WHAT COUNTS AS"
 * paragraphs. `file` must already exist on disk; callers that only have
 * source TEXT use `analyzeSource` below.
 */
function analyzeFile(file: string): { specifiers: readonly FoundSpecifier[]; awaits: readonly FoundAwait[] } {
  const snapshot = api.updateSnapshot({ openFiles: [file] });
  const project: Project | undefined = snapshot.getDefaultProjectForFile(file);
  const sf: SourceFile | undefined = project?.program.getSourceFile(file);
  if (!project || !sf) {
    throw new Error(`analyzeFile: the real compiler could not load/parse ${file}`);
  }

  const specifiers: FoundSpecifier[] = [];
  const awaits: FoundAwait[] = [];
  const lineOf = (node: Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  function recordSpecifier(expr: Expression | undefined): void {
    if (!expr) return;
    if (isStringLiteralLikeNode(expr)) {
      specifiers.push({ specifier: expr.text, line: lineOf(expr) });
    } else {
      // A non-literal (dynamically computed) specifier — see file
      // header's "WHAT COUNTS AS 'A SPECIFIER'" paragraph: recorded
      // under its own raw source text so `resolvesInsideAllowedRoots`
      // rejects it for not looking relative, rather than silently
      // having nothing to check.
      specifiers.push({ specifier: expr.getText(sf), line: lineOf(expr) });
    }
  }

  function visit(node: Node): void {
    if (isAwaitExpression(node)) {
      awaits.push({ line: lineOf(node) });
    } else if (isImportDeclaration(node)) {
      recordSpecifier(node.moduleSpecifier);
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      recordSpecifier(node.moduleReference.expression);
    } else if (isCallExpression(node)) {
      if (isImportExpression(node.expression)) {
        recordSpecifier(node.arguments[0]);
      } else if (isIdentifier(node.expression) && node.expression.text === "require") {
        recordSpecifier(node.arguments[0]);
      }
    }
    node.forEachChild(visit);
  }

  visit(sf);
  api.updateSnapshot({ closeFiles: [file] });
  return { specifiers, awaits };
}

/**
 * Analyzes a source SNIPPET rather than a real file on disk — every
 * synthetic test below (`analyzeSource("...")`) uses this. Materializes
 * `source` into a throwaway `.ts` file under a fresh temp directory,
 * analyzes it via `analyzeFile`, then removes the scratch directory
 * unconditionally.
 */
function analyzeSource(source: string): { specifiers: readonly FoundSpecifier[]; awaits: readonly FoundAwait[] } {
  const dir = mkdtempSync(join(tmpdir(), "shadow-run-domains-arch-scan-"));
  const file = join(dir, "snippet.ts");
  writeFileSync(file, source);
  try {
    return analyzeFile(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    const { specifiers, awaits } = analyzeFile(file);
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

  it("no non-test source file under domains/** contains the bare keyword `await`, anywhere (see file header for why blanket, not top-level-only, is the DELIBERATE, KEPT choice)", () => {
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
      const { specifiers } = analyzeSource(`import { netDeltas } from "../shared/net.js";\n`);
      expect(specifiers).toEqual([{ specifier: "../shared/net.js", line: 1 }]);
    });

    it("a comment or string merely mentioning 'await' is not flagged", () => {
      const source = [
        `// this comment mentions await but is not one`,
        `const s = "please await nothing here";`,
        `const awaited = 1;`,
        `const myAwaitHelper = () => 1;`,
      ].join("\n");
      const { awaits } = analyzeSource(source);
      expect(awaits).toEqual([]);
    });

    it("a genuine bare `await` keyword IS flagged, proving this test has teeth", () => {
      const { awaits } = analyzeSource(`async function f() {\n  const x = await Promise.resolve(1);\n  return x;\n}\n`);
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

  describe("EXPLOIT REGRESSION (independent verification): await hidden inside a template-literal ${...} interpolation, closed by the real-parser rewrite", () => {
    it("a bare `await` keyword inside a ${...} interpolation is caught — this passed the old tokenizer-based guard UNTOUCHED", () => {
      const source = 'export const x = `${await fetch("https://example.com")}`;';
      const { awaits } = analyzeSource(source);
      expect(awaits).toEqual([{ line: 1 }]);
    });

    it("await nested two interpolations deep is still caught — a real parser has no notion of 'nesting too deep to track'", () => {
      const source = "export const x = `${`${await Promise.resolve(1)}`}`;";
      const { awaits } = analyzeSource(source);
      expect(awaits).toEqual([{ line: 1 }]);
    });

    it("a non-relative specifier hidden inside a ${...} interpolation is also caught", () => {
      const source = "export const x = `${(() => import(`openai`))()}`;";
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toContainEqual({ specifier: "openai", line: 1 });
    });
  });

  describe("EXPLOIT REGRESSION (independent verification, round 4 — the tokenizer-ending bypass, confirmed identically in this file)", () => {
    it("a regex literal containing a backtick no longer swallows the rest of the file as inert string content, hiding a plain await", () => {
      const exploit = ["const re = /`/;", "async function f() { await g(); }", ""].join("\n");
      const control = ["const re = 1;", "async function f() { await g(); }", ""].join("\n");

      expect(analyzeSource(control).awaits).toEqual([{ line: 2 }]);
      expect(analyzeSource(exploit).awaits).toEqual([{ line: 2 }]);
    });

    it("the same regex-backtick shape hiding a non-relative import specifier, not just await", () => {
      const exploit = ['const re = /`/;', 'import openai from "openai";', ""].join("\n");
      const { specifiers } = analyzeSource(exploit);
      expect(specifiers).toEqual([{ specifier: "openai", line: 2 }]);
    });

    it("a dynamically COMPUTED import specifier is now flagged outright — previously an explicitly disclosed, undetectable gap", () => {
      const source = ["const specifierVar = \"openai\";", "import(specifierVar);", ""].join("\n");
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toEqual([{ specifier: "specifierVar", line: 2 }]);
    });
  });

  describe("does not overtighten: legitimate template-literal and regex shapes are still accepted", () => {
    it("a template literal containing the WORD 'await' as prose (no interpolation at all) is not flagged", () => {
      const source = "const msg = `please await nothing here, it is just words`;";
      const { awaits, specifiers } = analyzeSource(source);
      expect(awaits).toEqual([]);
      expect(specifiers).toEqual([]);
    });

    it("a benign NESTED template literal inside an interpolation is not flagged", () => {
      const source = "const msg = `outer ${`inner ${name} text`} more`;";
      const { awaits, specifiers } = analyzeSource(source);
      expect(awaits).toEqual([]);
      expect(specifiers).toEqual([]);
    });

    it("an ordinary interpolation like `${count} items` is not flagged", () => {
      const source = "const label = `${count} items`;";
      const { awaits, specifiers } = analyzeSource(source);
      expect(awaits).toEqual([]);
      expect(specifiers).toEqual([]);
    });

    it("a legitimate relative import specifier written inside a benign interpolation is still accepted, not merely un-flagged", () => {
      const fromFile = join(DOMAINS_ROOT, "calendar", "domain.ts");
      const source = "const mod = `${(() => import(`../shared/net.js`))()}`;";
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toContainEqual({ specifier: "../shared/net.js", line: 1 });
      expect(resolvesInsideAllowedRoots(fromFile, "../shared/net.js")).toBe(true);
    });

    it("an ordinary regex literal used for real string matching, with no backtick inside it, parses and scans normally", () => {
      const source = ["const isDigits = /^[0-9]+$/;", "async function f() { await g(); }", ""].join("\n");
      expect(analyzeSource(source).awaits).toEqual([{ line: 2 }]);
    });
  });
});
