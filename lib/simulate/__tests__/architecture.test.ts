import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
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
 * INVARIANT: `lib/simulate/**` NEVER reaches an LLM, the network, or a
 * Node built-in — `sim-plan.md` §A.2's structural answer to "you're just
 * asking a model to guess and calling it a simulation": "`lib/simulate/**`
 * is grep-tested to contain zero LLM-client and zero network imports ...
 * so 'you're just asking a model to guess' is falsifiable and false by
 * construction, not by assertion." The build brief additionally asks for
 * this to survive ordinary reformatting, citing two precedents from this
 * account's own history — read both before trusting any check here:
 *
 *   - decision-engine's `lib/__tests__/framework-free.test.ts`: its FIRST
 *     guard matched import/export keywords anchored to the START of a
 *     line (`^\s*(?:import|export)\b`). A real, committed, Prettier-
 *     wrapped multi-line import —
 *         import {
 *           useState,
 *           useEffect,
 *         } from "react";
 *     — defeated it outright: the line that actually carries `from
 *     "react"` is `} from "react";`, which does not start with `import`,
 *     so the line-anchored regex never even looked at it.
 *   - THIS repo's own `app/milestones.test.ts` drift guard (the DONE.html
 *     vs. PLAN.md consistency check) was bypassed FIVE separate times in
 *     this project's own commit history — every round the same shape: the
 *     guard tried to cleverly parse an open-ended, flexible surface and
 *     something legitimate kept almost-matching the pattern closely
 *     enough to slip past a slightly-too-permissive regex.
 *
 * THAT LESSON IS WHY THIS FILE IS AN ALLOWLIST, NOT A DENYLIST — see
 * `resolvesInsideAllowedRoots` below. That part of this file's design has
 * never been reopened and is not touched by anything in this section.
 *
 * FIX HISTORY, PATH-CONTAINMENT SIDE (`resolvesInsideAllowedRoots`,
 * unrelated to how specifiers/calls are FOUND — that history is below):
 *
 *   - ROUND 1 (independent verification): the allowlist originally
 *     checked specifier SYNTAX, not where it actually RESOLVES on disk —
 *     `import openai from "../../node_modules/next/package.json"` passed
 *     clean from `lib/simulate/adapter.ts`, because `../../node_modules/
 *     next/package.json` starts with `./`/`../` even though it plainly
 *     resolves into `node_modules/`. Fixed by resolving the specifier
 *     against the importing file's real directory and checking the
 *     result against a closed, explicit `ALLOWED_ROOTS` list (`lib/
 *     simulate/`, `lib/contracts/`), with `root + sep` prefix comparison
 *     so `lib/simulate-experimental` cannot pass by string-prefix
 *     coincidence with `lib/simulate`.
 *   - ROUND 2 (independent verification): the round-1 fix checked the
 *     TEXTUAL resolved path, never dereferencing a symlink — a real
 *     symlink placed inside `lib/simulate/`, pointing outside the
 *     repository, passed the textual check while Node's real module
 *     resolution would actually load the external target. Fixed by
 *     `resolvesToRealAllowedPath` additionally `realpathSync`-ing the
 *     resolved path (falling back to the enclosing directory when the
 *     exact leaf does not exist, matching this repo's `.js`-specifier/
 *     `.ts`-file convention, and failing closed if neither resolves) and
 *     comparing against `realpathSync`'d roots, textual check kept
 *     alongside rather than replaced.
 *
 * See the "sanity: the containment rule itself" block below for the
 * direct regression proof of both rounds; neither is reopened here.
 *
 * FIX HISTORY, HOW SPECIFIERS/CALLS ARE FOUND AT ALL (the part THIS
 * revision replaces outright):
 *
 *   - ROUNDS 1–3 (a hand-rolled, character-by-character tokenizer):
 *     treated `"`/`'`/`` ` `` as opaque string spans (so a specifier
 *     context was matched by inspecting the CODE immediately preceding a
 *     literal, never a literal's own contents) and separately watched
 *     for a bare `fetch(` call in the non-string code stream. ROUND 3
 *     made template-literal `${...}` interpolations re-enter "code mode"
 *     recursively, closing a bypass where `` `${await
 *     fetch("https://example.com")}` `` hid a live `fetch(` call inside
 *     what the tokenizer had been treating as one opaque backtick span.
 *   - ROUND 4 (independent verification — THE ONE THAT ENDED THE
 *     TOKENIZER, NOT JUST PATCHED IT): a regex literal containing a
 *     backtick defeats ROUND 3's fix completely, for the REST OF THE
 *     FILE, because the tokenizer has no concept of a regex literal at
 *     all:
 *
 *         const re = /`/;
 *         fetch("https://evil.example");
 *
 *     A `` ` `` inside the regex is indistinguishable, to a tokenizer
 *     with no regex-literal handling, from the START of a template
 *     literal — so `scanTemplateBody` began scanning forward for a
 *     matching close backtick that never comes, and silently swallowed
 *     every line after it, INCLUDING the perfectly plain, unobfuscated
 *     `fetch(...)` call, as inert string content. Confirmed directly:
 *     `bareFetchCalls: []` for the snippet above, versus `[{"line":2}]`
 *     for the same snippet with `const re = 1;` in place of the regex.
 *     Unlike every gap ROUND 3 already disclosed (which all require the
 *     forbidden call to avoid being spelled plainly — `globalThis
 *     ["fetch"]`, an alias, a computed specifier), THIS one hides a
 *     completely plain `fetch(...)` behind ordinary regex syntax earlier
 *     in the file — outside every boundary this file's own gap list had
 *     named, not a new instance of an already-disclosed one.
 *
 *     Regex-vs-division is a genuinely CONTEXT-SENSITIVE lexical
 *     ambiguity in JavaScript/TypeScript — whether a `/` starts a regex
 *     or is a division operator depends on grammar position (does the
 *     parser expect an expression or an operand here), which a character
 *     tokenizer with no parser behind it cannot resolve correctly in
 *     general. Patching this specific case (add a heuristic for "does
 *     `/` start a regex here") would be the FOURTH round of hand-rolled
 *     lexing fixes on this exact function, echoing this account's own
 *     precedent named in the original header: `decision-engine`'s
 *     `framework-free.test.ts` needed real character-by-character
 *     tokenizing after regex anchoring failed once; separately, one
 *     function in this repo's own M2 needed six rounds and five bypasses
 *     before the actual fix turned out to be DELETING the guessed
 *     capability rather than parsing it more cleverly. Both are the same
 *     lesson: a hand-rolled scanner's gaps are open-ended, and finding
 *     one more of them is not evidence the scanner is now complete.
 *
 * THE FIX: DELETE THE TOKENIZER. `tokenize`/`scanCode`/`scanTemplateBody`
 * are gone. This file now parses every file/snippet it inspects with the
 * REAL TypeScript compiler — `typescript` is already this repo's own
 * devDependency, used for `npm run typecheck` — via `typescript/unstable
 * /sync`'s `API`/`Project`/`Program`, and walks the resulting AST with
 * `Node#forEachChild` (a real method on every node this API returns, not
 * a hand-rolled traversal). `analyzeFile`/`analyzeSource` (below) replace
 * `tokenize`; every existing test's assertions are unchanged — only the
 * mechanism producing `{ specifiers, bareFetchCalls }` changed, from text
 * scanning to compiling. A real parser has no regex-vs-template ambiguity
 * (or any of the other string/comment/nesting ambiguities the tokenizer
 * kept needing new rounds for) because it is the SAME PARSER the language
 * itself is defined by, not an approximation of it.
 *
 * WHAT COUNTS AS "A SPECIFIER" NOW, PRECISELY (the AST-native replacement
 * for the old text-based `SPECIFIER_CONTEXT_PATTERNS`): the module
 * specifier of an `ImportDeclaration` (`import ... from "x"` or the
 * side-effect-only `import "x"`), the expression of an
 * `ExternalModuleReference` (`import x = require("x")`), and the first
 * argument of a `require(...)` call or a dynamic `import(...)` call
 * (detected via `isImportExpression`, the real AST predicate for the
 * `import` keyword used as a call target — not a textual `import\s*\(`
 * match). When that argument is a string literal or a no-substitution
 * template literal, its literal text is recorded, exactly as the old
 * tokenizer did. When it is ANYTHING ELSE — a variable, a computed
 * expression, a template literal WITH interpolation — its raw source
 * text is recorded instead, and `resolvesInsideAllowedRoots` rejects it
 * for not looking like a relative specifier, same as any other offender.
 * This is a real improvement over the old tokenizer, not a side effect:
 * a dynamically-computed specifier (`import(someVariable)`) was
 * PREVIOUSLY, EXPLICITLY DISCLOSED as unreachable ("nothing resolvable is
 * ever a string literal in scan reach") — the AST sees the CALL is an
 * import regardless of what its argument looks like, so it can flag a
 * non-literal argument outright instead of silently having nothing to
 * look at.
 *
 * WHAT COUNTS AS "A BARE `fetch(` CALL" NOW: a `CallExpression` whose
 * `expression` is an `Identifier` with text `"fetch"` — the AST-native
 * replacement for the old `BARE_FETCH_TAIL` regex, with the identical
 * scope: `obj.fetch(...)` (a `PropertyAccessExpression`, not an
 * `Identifier`) and `refetchAll()`/`myFetcher()` (different `Identifier`
 * text) are excluded exactly as before, but now because the AST says so
 * structurally, not because a regex's negative lookbehind/lookahead
 * happened to get the edge cases right.
 *
 * WHAT IS AND ISN'T CAUGHT NOW, STATED PLAINLY (see the "teeth"/
 * "false-positive discipline" blocks below for the direct proof of each
 * claim, not just this paragraph's word):
 *   - CAUGHT: every case the old tokenizer's rounds 1–3 caught (a
 *     Prettier-wrapped multi-line import, a template-literal dynamic
 *     import, a bare `require()`, a side-effect-only import, `fetch(`
 *     hidden inside a `${...}` interpolation at any nesting depth), PLUS
 *     the round-4 regex-literal bypass (a real parser never confuses a
 *     regex literal for a template literal, or for anything else — that
 *     is not a special case, it is just correct parsing), PLUS a
 *     dynamically-computed import specifier (previously undetectable,
 *     now flagged as a non-relative offender).
 *   - STILL NOT CAUGHT, BY DESIGN, NOT OVERSIGHT: anything that never
 *     spells `fetch(` or an import/require CALL as CODE at all —
 *     `globalThis["fetch"]`, a destructured/aliased reference (`const f
 *     = fetch; f(url)`), or a keyword/URL typed out only inside an
 *     ORDINARY string/comment meant for `eval`/`Function(...)` later.
 *     Strings and comments stay deliberately opaque as DATA — the real
 *     parser does not execute or re-interpret their contents any more
 *     than the old tokenizer did, and re-scanning literal text for
 *     keywords would reintroduce exactly the false-positive-prone
 *     "cleverly parse a flexible surface" failure this file's own header
 *     already argues against. These gaps are semantic (the code never
 *     names the forbidden operation at all), not lexical (a real parser
 *     has no lexical/syntactic blind spots left for this file's scope —
 *     that is the whole point of using one).
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SIMULATE_ROOT = join(REPO_ROOT, "lib", "simulate");
const CONTRACTS_ROOT = join(REPO_ROOT, "lib", "contracts");
/** The closed list of directories a `lib/simulate/**` source file may resolve an import into — itself, and the one frozen dependency it is allowed to use. See the file header's "FIX HISTORY, PATH-CONTAINMENT SIDE" for why containment against THIS list, not specifier syntax, is the actual property being checked. */
const ALLOWED_ROOTS: readonly string[] = [SIMULATE_ROOT, CONTRACTS_ROOT];
/** The SAME roots, realpath'd once at module load — comparing a realpath'd candidate against un-normalized `ALLOWED_ROOTS` would misfire the moment the repository itself sits under a symlink (common on macOS, where `/tmp` is itself a symlink to `/private/tmp`). Computed eagerly, not defensively wrapped in try/catch: `lib/simulate/` and `lib/contracts/` not existing at all would mean this very test file couldn't have been found to run in the first place. */
const REAL_ALLOWED_ROOTS: readonly string[] = ALLOWED_ROOTS.map((root) => realpathSync(root));
/** A representative real file location, used throughout this file's synthetic (no-real-file-needed) specifier checks below — `resolve()` is pure path arithmetic and does not require `adapter.ts` to be the file actually being checked. */
const FROM_ADAPTER = join(SIMULATE_ROOT, "adapter.ts");

function listNonTestSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "__tests__") continue; // test fixtures/specs are exempt — see file header: this invariant is about the shipped engine, not its own test suite.
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

interface FoundBareFetchCall {
  readonly line: number;
}

/**
 * ONE `API` instance for this whole file, spun up once and reused across
 * every test — spawning the real compiler's backing process costs real
 * (if small) time (tens of milliseconds), so paying it once in
 * `beforeAll` rather than per assertion keeps this file fast. Every
 * `analyzeSource`/`analyzeFile` call below goes through this instance.
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
 * paragraphs for the precise rules. `file` must already exist on disk;
 * callers that only have source TEXT use `analyzeSource` below, which
 * materializes a scratch file first.
 */
function analyzeFile(file: string): { specifiers: readonly FoundSpecifier[]; bareFetchCalls: readonly FoundBareFetchCall[] } {
  const snapshot = api.updateSnapshot({ openFiles: [file] });
  const project: Project | undefined = snapshot.getDefaultProjectForFile(file);
  const sf: SourceFile | undefined = project?.program.getSourceFile(file);
  if (!project || !sf) {
    throw new Error(`analyzeFile: the real compiler could not load/parse ${file}`);
  }

  const specifiers: FoundSpecifier[] = [];
  const bareFetchCalls: FoundBareFetchCall[] = [];
  const lineOf = (node: Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  function recordSpecifier(expr: Expression | undefined): void {
    if (!expr) return;
    if (isStringLiteralLikeNode(expr)) {
      specifiers.push({ specifier: expr.text, line: lineOf(expr) });
    } else {
      // A non-literal (dynamically computed) specifier — see file
      // header's "WHAT COUNTS AS 'A SPECIFIER'" paragraph: recorded
      // under its own raw source text so `resolvesInsideAllowedRoots`
      // rejects it for not looking like a relative specifier, rather
      // than silently having nothing to check (the old tokenizer's
      // disclosed, now-closed gap).
      specifiers.push({ specifier: expr.getText(sf), line: lineOf(expr) });
    }
  }

  function visit(node: Node): void {
    if (isImportDeclaration(node)) {
      recordSpecifier(node.moduleSpecifier);
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      recordSpecifier(node.moduleReference.expression);
    } else if (isCallExpression(node)) {
      if (isImportExpression(node.expression)) {
        recordSpecifier(node.arguments[0]);
      } else if (isIdentifier(node.expression) && node.expression.text === "require") {
        recordSpecifier(node.arguments[0]);
      } else if (isIdentifier(node.expression) && node.expression.text === "fetch") {
        bareFetchCalls.push({ line: lineOf(node) });
      }
    }
    node.forEachChild(visit);
  }

  visit(sf);
  api.updateSnapshot({ closeFiles: [file] });
  return { specifiers, bareFetchCalls };
}

/**
 * Analyzes a source SNIPPET rather than a real file on disk — every
 * synthetic test below (`analyzeSource("...")`) uses this. Materializes
 * `source` into a throwaway `.ts` file under a fresh temp directory (the
 * real compiler needs a real file — see `typescript/unstable/sync`'s own
 * design, LSP-shaped rather than string-in/AST-out), analyzes it via
 * `analyzeFile`, then removes the scratch directory unconditionally.
 */
function analyzeSource(source: string): { specifiers: readonly FoundSpecifier[]; bareFetchCalls: readonly FoundBareFetchCall[] } {
  const dir = mkdtempSync(join(tmpdir(), "shadow-run-arch-scan-"));
  const file = join(dir, "snippet.ts");
  writeFileSync(file, source);
  try {
    return analyzeFile(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Checks `candidate` (already assumed to be a REAL, realpath'd absolute
 * path — never call this with a merely-resolved-but-not-yet-realpath'd
 * one) against `REAL_ALLOWED_ROOTS`. Factored out so both the leaf-level
 * and directory-level fallbacks in `resolvesToRealAllowedPath` (below)
 * compare against the exact same normalized roots.
 */
function isRealPathContained(candidate: string): boolean {
  return REAL_ALLOWED_ROOTS.some((root) => candidate === root || candidate.startsWith(root + sep));
}

/**
 * The SECOND check `resolvesInsideAllowedRoots` runs, ONLY on a path that
 * already passed the textual one — see the file header's "FIX HISTORY,
 * PATH-CONTAINMENT SIDE" (round 2) for the full argument. Tries the exact
 * resolved leaf first (catches a symlink placed AT that exact name,
 * whether a file or a directory); if that name does not exist at all,
 * falls back to the enclosing directory (safe — a nonexistent name
 * cannot itself be a symlink, and the directory it would live in is what
 * a genuine import actually depends on existing); if NEITHER resolves to
 * anything real, fails closed.
 */
function resolvesToRealAllowedPath(resolved: string): boolean {
  try {
    return isRealPathContained(realpathSync(resolved));
  } catch {
    // Falls through to the directory-level attempt below — see this
    // function's own doc comment.
  }
  try {
    return isRealPathContained(realpathSync(dirname(resolved)));
  } catch {
    return false; // FAIL CLOSED: neither the leaf nor its enclosing directory resolves to anything real.
  }
}

/**
 * A specifier is allowed if and only if (1) it is syntactically relative
 * (`./...` or `../...` — a bare specifier like `"openai"` or `"node:fs"`,
 * or the raw source text of a non-literal specifier, is rejected outright
 * here, BEFORE any path resolution), (2) resolving it against `fromFile`'s
 * real directory lands TEXTUALLY inside one of `ALLOWED_ROOTS`, AND (3)
 * that same resolved path ALSO lands inside the allowed roots once
 * symlinks are followed (`resolvesToRealAllowedPath`). See the file
 * header's "FIX HISTORY, PATH-CONTAINMENT SIDE" for the exploits rounds 1
 * and 2 each close.
 */
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

interface FetchOffender {
  readonly file: string;
  readonly line: number;
}

function scan(): { specifierOffenders: SpecifierOffender[]; fetchOffenders: FetchOffender[] } {
  const specifierOffenders: SpecifierOffender[] = [];
  const fetchOffenders: FetchOffender[] = [];
  for (const file of listNonTestSourceFiles(SIMULATE_ROOT)) {
    const { specifiers, bareFetchCalls } = analyzeFile(file);
    for (const { specifier, line } of specifiers) {
      if (!resolvesInsideAllowedRoots(file, specifier)) {
        specifierOffenders.push({ file: relative(REPO_ROOT, file), line, specifier });
      }
    }
    for (const { line } of bareFetchCalls) {
      fetchOffenders.push({ file: relative(REPO_ROOT, file), line });
    }
  }
  return { specifierOffenders, fetchOffenders };
}

describe("lib/simulate/** never reaches an LLM, the network, or a Node built-in", () => {
  it("every import/require specifier in non-test source is relative AND resolves inside lib/simulate/ or lib/contracts/ — no bare package, no node: built-in, no absolute path, no relative escape into node_modules or a sibling milestone", () => {
    const { specifierOffenders } = scan();
    if (specifierOffenders.length > 0) {
      const report = specifierOffenders.map((o) => `${o.file}:${o.line}: imports "${o.specifier}"`).join("\n");
      throw new Error(
        `lib/simulate/** may only import a specifier that resolves inside lib/simulate/ or lib/contracts/ — found ` +
          `${specifierOffenders.length} offending import(s). This is exactly how an LLM client, a network library, ` +
          `or a Node built-in could enter this milestone's frozen boundary — either directly (a bare specifier) or ` +
          `via a relative path that merely LOOKS contained but actually walks out via "../" into node_modules or ` +
          `elsewhere:\n${report}`,
      );
    }
    expect(specifierOffenders).toEqual([]);
  });

  it("no non-test source file calls the bare global fetch(...)", () => {
    const { fetchOffenders } = scan();
    if (fetchOffenders.length > 0) {
      const report = fetchOffenders.map((o) => `${o.file}:${o.line}`).join("\n");
      throw new Error(`lib/simulate/** may never call the global fetch() — found ${fetchOffenders.length} call(s):\n${report}`);
    }
    expect(fetchOffenders).toEqual([]);
  });

  describe("sanity: the containment rule itself", () => {
    it("accepts relative specifiers that resolve inside lib/simulate/ itself", () => {
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "./path.js")).toBe(true);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "./action.js")).toBe(true);
    });

    it("accepts a relative specifier that resolves into lib/contracts/ — the one frozen dependency this milestone is allowed to use", () => {
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "../contracts/index.js")).toBe(true);
    });

    it("rejects every non-relative (bare/absolute) shape outright, with no enumeration needed", () => {
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "node:fs")).toBe(false);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "fs")).toBe(false);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "openai")).toBe(false);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "@anthropic-ai/sdk")).toBe(false);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "node-fetch")).toBe(false);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "react")).toBe(false);
      // A package nobody on this project has ever heard of — the exact
      // case an enumerated denylist can never cover, and this rule
      // rejects it anyway, for free, because it isn't relative.
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "some-llm-sdk-invented-tomorrow")).toBe(false);
    });

    it("EXPLOIT REGRESSION (HIGH-2, independent verification): a SYNTACTICALLY relative specifier that resolves outside both allowed roots, into the real node_modules/, is rejected", () => {
      const specifier = "../../node_modules/next/package.json";
      const resolved = resolve(dirname(FROM_ADAPTER), specifier);

      // Confirm this is not a hypothetical: the escape really does land
      // on a real path in this actual repository, exactly as
      // independent verification confirmed with its own `existsSync`
      // check.
      expect(existsSync(resolved)).toBe(true);
      expect(resolved.startsWith(SIMULATE_ROOT + sep)).toBe(false);
      expect(resolved.startsWith(CONTRACTS_ROOT + sep)).toBe(false);

      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifier)).toBe(false);
    });

    it("rejects an escape into a SIBLING milestone's own frozen directory (e.g. a future lib/rollback/), not just node_modules", () => {
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "../rollback/apply-deltas.js")).toBe(false);
    });

    it("does not fall for a sibling directory that merely shares lib/simulate's name as a string prefix (e.g. a hypothetical lib/simulate-experimental/)", () => {
      const fakeSiblingFile = join(REPO_ROOT, "lib", "simulate-experimental", "evil.ts");
      // Importing FROM inside a same-prefixed sibling should not be
      // treated as importing from inside lib/simulate/ itself — this
      // guards the `root + sep` comparison, not `startsWith(root)`.
      expect(resolvesInsideAllowedRoots(fakeSiblingFile, "./evil-payload.js")).toBe(false);
    });

    it("EXPLOIT REGRESSION (HIGH-2, ROUND 2 — independent verification): a REAL symlink inside lib/simulate/, pointing at a directory outside the repository, is rejected once dereferenced", () => {
      // A genuine filesystem symlink, created for the duration of this
      // one test only — never committed, never left behind. This is the
      // exact exploit shape independent verification confirmed: a
      // symlink whose TEXTUAL path looks fully contained inside
      // lib/simulate/, but whose REAL target is not.
      const symlinkName = "__zz_symlink_regression_do_not_commit__";
      const symlinkPath = join(SIMULATE_ROOT, symlinkName);
      const externalTarget = mkdtempSync(join(tmpdir(), "shadow-run-symlink-attack-"));
      writeFileSync(join(externalTarget, "evil.js"), "export default 1;\n");

      try {
        symlinkSync(externalTarget, symlinkPath, "dir");
        const specifier = `./${symlinkName}/evil.js`;
        const resolved = resolve(dirname(FROM_ADAPTER), specifier);

        // Confirm the premise: TEXTUALLY, this specifier does not escape
        // lib/simulate/ at all — it is one path segment inside it. The
        // textual check alone would (correctly, on its own terms) pass
        // this; the symlink is what makes the real target different.
        expect(resolved.startsWith(SIMULATE_ROOT + sep)).toBe(true);

        // But the REAL, dereferenced path is the external directory
        // this symlink actually points to — confirmed directly, not
        // assumed, the same way independent verification confirmed it.
        const real = realpathSync(resolved);
        expect(real.startsWith(SIMULATE_ROOT + sep)).toBe(false);
        expect(real.startsWith(CONTRACTS_ROOT + sep)).toBe(false);

        expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifier)).toBe(false);
      } finally {
        // Cleanup runs even if an assertion above throws — no symlink,
        // and no scratch directory, is ever left behind for git to see.
        rmSync(symlinkPath, { force: true, recursive: true }); // recursive is safe here — Node never dereferences a symlink for removal, it just unlinks the symlink entry itself; recursive is only needed because rmSync's own directory-ness check sees a symlink-to-directory and otherwise refuses.
        rmSync(externalTarget, { recursive: true, force: true });
      }
    });

    it("sanity: a symlinked DIRECTORY that points somewhere legitimate (still outside both roots, but not malicious) is treated identically — this check is about containment, not intent", () => {
      // Same mechanism as the exploit regression above, confirming the
      // check has no special-case for "looks like an attack" — it
      // rejects ANY real escape, benign-looking or not, which is the
      // only way a structural check can stay honest.
      const symlinkName = "__zz_symlink_benign_do_not_commit__";
      const symlinkPath = join(SIMULATE_ROOT, symlinkName);
      const externalTarget = mkdtempSync(join(tmpdir(), "shadow-run-symlink-benign-"));
      writeFileSync(join(externalTarget, "harmless.js"), "export default 2;\n");

      try {
        symlinkSync(externalTarget, symlinkPath, "dir");
        expect(resolvesInsideAllowedRoots(FROM_ADAPTER, `./${symlinkName}/harmless.js`)).toBe(false);
      } finally {
        rmSync(symlinkPath, { force: true, recursive: true }); // recursive is safe here — Node never dereferences a symlink for removal, it just unlinks the symlink entry itself; recursive is only needed because rmSync's own directory-ness check sees a symlink-to-directory and otherwise refuses.
        rmSync(externalTarget, { recursive: true, force: true });
      }
    });

    it("FAIL CLOSED (round-2 fix, point 1): a specifier whose target does not exist under any name — leaf or enclosing directory — is rejected, not waved through", () => {
      // Neither "totally-nonexistent-dir" nor anything inside it exists
      // on disk at all. resolvesToRealAllowedPath's own directory-level
      // fallback must itself fail here, and the overall function must
      // return false, not throw and not default to true.
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "./totally-nonexistent-dir/also-nonexistent.js")).toBe(false);
    });

    it("does not regress the legitimate .js-specifier-to-.ts-file convention this codebase actually uses (the directory-level fallback's whole reason to exist)", () => {
      // These are real, load-bearing cases: every genuine import in this
      // milestone's own source is exactly this shape — a ".js" specifier
      // whose literal name does not exist, because the real file on disk
      // is ".ts" (this repo's NodeNext convention). The round-2 fix's
      // leaf-then-directory fallback must keep accepting these, not just
      // the round-1 fix's textual check.
      expect(existsSync(join(SIMULATE_ROOT, "action.js"))).toBe(false); // confirms the premise: the literal name really is absent.
      expect(existsSync(join(SIMULATE_ROOT, "action.ts"))).toBe(true); // the real file, under a different extension.
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "./action.js")).toBe(true);
    });
  });

  describe("teeth: the same evasions that defeated the sibling's line-anchored guard, plus the round-4 regex bypass, confirmed caught here", () => {
    it("a multi-line named import — the exact Prettier shape that defeated decision-engine's original matcher", () => {
      const source = ["import {", "  readFileSync,", "  writeFileSync,", '} from "node:fs";'].join("\n");
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toEqual([{ specifier: "node:fs", line: 4 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("a template-literal dynamic import with no interpolation", () => {
      const { specifiers } = analyzeSource("const mod = await import(`openai`);");
      expect(specifiers).toEqual([{ specifier: "openai", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("a bare require()", () => {
      const { specifiers } = analyzeSource('const http = require("node:http");');
      expect(specifiers).toEqual([{ specifier: "node:http", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("a side-effect-only bare import", () => {
      const { specifiers } = analyzeSource('import "some-polyfill";');
      expect(specifiers).toEqual([{ specifier: "some-polyfill", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("fetch called after whitespace, and fetch called with a preceding newline (both real reformatting shapes)", () => {
      expect(analyzeSource("fetch (url)").bareFetchCalls).toEqual([{ line: 1 }]);
      expect(analyzeSource("const x =\n  fetch(url)").bareFetchCalls).toEqual([{ line: 2 }]);
    });

    it("fetch reached via a template-literal-wrapped identifier is still a bare call, not a specifier — confirms the fetch scan and the specifier scan don't blind each other", () => {
      const source = 'const result = fetch(`https://example.com/${id}`);';
      expect(analyzeSource(source).bareFetchCalls).toEqual([{ line: 1 }]);
    });

    it("EXPLOIT REGRESSION (independent verification, round 3): a bare fetch(...) call hidden inside a template-literal ${...} interpolation is caught", () => {
      const source = 'export const x = `${await fetch("https://example.com")}`;';
      const { bareFetchCalls } = analyzeSource(source);
      expect(bareFetchCalls).toEqual([{ line: 1 }]);
    });

    it("EXPLOIT REGRESSION variant: a non-relative specifier hidden inside a ${...} interpolation (a dynamic import assembled inside the interpolation) is also caught", () => {
      const source = "export const x = `${(() => import(`openai`))()}`;";
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toContainEqual({ specifier: "openai", line: 1 });
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "openai")).toBe(false);
    });

    it("EXPLOIT REGRESSION variant: fetch(...) nested two interpolations deep is still caught — a real parser has no notion of 'nesting too deep to track'", () => {
      const source = "export const x = `${`${await fetch(\"https://example.com\")}`}`;";
      const { bareFetchCalls } = analyzeSource(source);
      expect(bareFetchCalls).toEqual([{ line: 1 }]);
    });

    it("EXPLOIT REGRESSION (independent verification, round 4 — the tokenizer-ending bypass): a regex literal containing a backtick no longer swallows the rest of the file as inert string content", () => {
      const exploit = ["const re = /`/;", 'fetch("https://evil.example");', ""].join("\n");
      const control = ["const re = 1;", 'fetch("https://evil.example");', ""].join("\n");

      // Confirm the control case behaves as expected on its own terms —
      // this is what the exploit ALSO must produce, once fixed.
      expect(analyzeSource(control).bareFetchCalls).toEqual([{ line: 2 }]);

      expect(analyzeSource(exploit).bareFetchCalls).toEqual([{ line: 2 }]);
    });

    it("EXPLOIT REGRESSION variant (round 4): the same regex-backtick shape hiding a non-relative import specifier, not just fetch(", () => {
      const exploit = ['const re = /`/;', 'import openai from "openai";', ""].join("\n");
      const { specifiers } = analyzeSource(exploit);
      expect(specifiers).toEqual([{ specifier: "openai", line: 2 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "openai")).toBe(false);
    });

    it("a dynamically COMPUTED import specifier is now flagged outright — previously an explicitly disclosed, undetectable gap; the AST sees the call is an import regardless of its argument's shape", () => {
      const source = ["const specifierVar = \"openai\";", "import(specifierVar);", ""].join("\n");
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toEqual([{ specifier: "specifierVar", line: 2 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "specifierVar")).toBe(false);
    });
  });

  describe("false-positive discipline: only real specifiers/calls, never identifiers, comments, or unrelated strings", () => {
    it("does NOT flag a relative import whose filename merely contains the word 'fetch'", () => {
      const { specifiers } = analyzeSource('import { helper } from "./fetchable-helpers.js";');
      expect(specifiers).toEqual([{ specifier: "./fetchable-helpers.js", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(true);
    });

    it("does NOT flag `obj.fetch(...)` — a property access, not the global function", () => {
      expect(analyzeSource("cache.fetch(key)").bareFetchCalls).toEqual([]);
    });

    it("does NOT flag an identifier that merely contains 'fetch' as a substring, e.g. `refetchAll()` or `myFetcher()`", () => {
      expect(analyzeSource("refetchAll()").bareFetchCalls).toEqual([]);
      expect(analyzeSource("myFetcher()").bareFetchCalls).toEqual([]);
    });

    it("does NOT flag a comment that mentions fetch/openai/node: by name — comments are not part of the AST at all", () => {
      const source = [
        "// This module must never call fetch() or import openai or node:http.",
        "/* also never require('node-fetch') */",
        'import { helper } from "./helper.js";',
      ].join("\n");
      const { specifiers, bareFetchCalls } = analyzeSource(source);
      expect(specifiers).toEqual([{ specifier: "./helper.js", line: 3 }]);
      expect(bareFetchCalls).toEqual([]);
    });

    it('does NOT false-positive on a string literal that embeds literal "fetch(" and \'from "openai"\' text purely as DATA', () => {
      // This is the exact hazard framework-free.test.ts's header names by
      // name: a naive whole-file regex over raw text would find these
      // patterns inside a STRING LITERAL and flag it for violating the
      // rule it merely mentions. A real parser treats a string literal's
      // contents as a VALUE, never re-interpreting them as code.
      const line = 'const example = \'const x = fetch("y"); import z from "openai";\';';
      const { specifiers, bareFetchCalls } = analyzeSource(line);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: a template literal containing the WORD 'await' as prose (no interpolation at all) is not flagged", () => {
      const source = 'const msg = `please await nothing here, it is just words`;';
      const { specifiers, bareFetchCalls } = analyzeSource(source);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: a benign NESTED template literal inside an interpolation is not flagged", () => {
      const source = "const msg = `outer ${`inner ${name} text`} more`;";
      const { specifiers, bareFetchCalls } = analyzeSource(source);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: an ordinary interpolation like `${count} items` is not flagged", () => {
      const source = "const label = `${count} items`;";
      const { specifiers, bareFetchCalls } = analyzeSource(source);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: a legitimate relative import specifier written inside a benign interpolation is still accepted, not merely un-flagged", () => {
      const source = "const mod = `${(() => import(`./adapter.js`))()}`;";
      const { specifiers } = analyzeSource(source);
      expect(specifiers).toContainEqual({ specifier: "./adapter.js", line: 1 });
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "./adapter.js")).toBe(true);
    });

    it("does NOT overtighten: an ordinary regex literal used for real string matching, with no backtick inside it, parses and scans normally", () => {
      const source = ["const isDigits = /^[0-9]+$/;", 'fetch("https://evil.example");', ""].join("\n");
      expect(analyzeSource(source).bareFetchCalls).toEqual([{ line: 2 }]);
    });

    it("does not false-positive on ordinary relative imports already used throughout this milestone", () => {
      const specifiers = ["./path.js", "../contracts/index.js", "./action.js", "./adapter.js"];
      for (const specifier of specifiers) {
        expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifier)).toBe(true);
      }
    });
  });

  it("sanity: the scan actually walked real files under lib/simulate/, and excludes __tests__", () => {
    const files = listNonTestSourceFiles(SIMULATE_ROOT);
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files.some((f) => f.endsWith("simulate.ts"))).toBe(true);
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
  });

  it("sanity: this repo's OWN lib/simulate/** source passes both checks right now (a true positive on the real codebase, not just synthetic fixtures)", () => {
    const { specifierOffenders, fetchOffenders } = scan();
    expect(specifierOffenders).toEqual([]);
    expect(fetchOffenders).toEqual([]);
  });
});
