import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * INVARIANT: `lib/simulate/**` NEVER reaches an LLM, the network, or a
 * Node built-in — `sim-plan.md` §A.2's structural answer to "you're just
 * asking a model to guess and calling it a simulation": "`lib/simulate/**`
 * is grep-tested to contain zero LLM-client and zero network imports ...
 * so 'you're just asking a model to guess' is falsifiable and false by
 * construction, not by assertion." The build brief additionally asks for
 * this to survive ordinary reformatting, citing two precedents from this
 * account's own history — read both before trusting any regex here:
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
 *     so the line-anchored regex never even looked at it. Two further
 *     evasions (a template-literal dynamic import, a bare `require()`)
 *     were found in the same review. The fix there was to stop matching
 *     STATEMENTS (line position) and instead find SPECIFIERS wherever a
 *     `from`/`import(`/`require(` context precedes them, via a real
 *     character-by-character tokenizer that treats strings and comments
 *     as opaque spans. This file reuses that exact tokenizer shape.
 *   - THIS repo's own `app/milestones.test.ts` drift guard (the DONE.html
 *     vs. PLAN.md consistency check) was bypassed FIVE separate times in
 *     this project's own commit history (`git log`: "Fix drift guard
 *     round 4", "round 5 removed nested-element support entirely", etc.)
 *     — every round was the same shape: the guard tried to cleverly parse
 *     an open-ended, flexible surface (an HTML table's cell contents,
 *     tolerating nested elements, whitespace variations...) and something
 *     legitimate kept almost-matching the pattern closely enough to slip
 *     past a slightly-too-permissive regex. The lesson taken here,
 *     directly: **prefer checking a canonical, unambiguous form over
 *     cleverly parsing a flexible one.**
 *
 * THAT LESSON IS WHY THIS FILE IS AN ALLOWLIST, NOT A DENYLIST. A denylist
 * ("ban `openai`, `@anthropic-ai/sdk`, `node-fetch`, `axios`, every
 * `node:*` built-in, ...") is exactly the "flexible surface" shape that
 * kept losing above — it requires enumerating every bad package NAME
 * ahead of time, and a package this list's author didn't think to name
 * (a new SDK, an obscure network client, a differently-cased or scoped
 * variant) sails through untouched, forever, until someone notices. The
 * canonical, unambiguous form this file checks instead is: **every
 * non-test source file under `lib/simulate/**` may import ONLY via a
 * relative specifier** (starting with `./` or `../`) pointing somewhere
 * inside this repository. That single rule bans `node:fs`, `openai`,
 * `node-fetch`, a brand-new never-yet-invented LLM SDK, and everything
 * else bare/absolute, all in one unambiguous test with no enumeration to
 * keep current — it is checking WHAT SHAPE AN IMPORT IS ALLOWED TO HAVE,
 * not guessing at what shape a bad one might take.
 *
 * The one thing an import allowlist cannot reach: the global `fetch`
 * function needs no import at all (it is ambient in Node 18+ and every
 * browser). So this file ALSO bans a bare, standalone `fetch(` CALL
 * anywhere in non-test source under `lib/simulate/**` — checked the same
 * tokenizer-based way (never inside a string or comment, and not when it
 * is a property access like `obj.fetch(`, which is a different, unrelated
 * method this test has no basis to forbid).
 *
 * FALSE-POSITIVE DISCIPLINE, MIRRORING `framework-free.test.ts`'S OWN: a
 * relative import of a LOCAL helper file that happens to be named
 * something like `./fetchable.js` must not be flagged (it isn't `fetch(`,
 * it's a specifier, checked by the allowlist rule, and it's relative, so
 * it passes that rule too) — and a comment or string that merely MENTIONS
 * `fetch`, `openai`, or `node:http` as prose must not be flagged either.
 * Both are proven in the "false-positive discipline" block below,
 * including this file's OWN sanity-test strings, the exact hazard
 * `framework-free.test.ts`'s header names by name.
 *
 * FIX (independent verification, first round): THE ALLOWLIST ORIGINALLY
 * CHECKED SYNTAX, NOT CONTAINMENT — a real, confirmed exploit, not a
 * theoretical one. `isAllowedSpecifier` (as first written) only tested
 * whether a specifier's TEXT started with `./` or `../`; it never asked
 * where that specifier actually RESOLVES to on disk. So this passed
 * clean, from a file located at `lib/simulate/adapter.ts`:
 *
 *     import openai from "../../node_modules/next/package.json";
 *
 * `../../node_modules/next/package.json`, resolved against
 * `lib/simulate/`'s real location, lands squarely inside this repo's
 * real `node_modules/` — confirmed with `existsSync` in this file's own
 * regression test below, not assumed. A relative specifier can walk
 * arbitrarily far up the tree via repeated `../` and land ANYWHERE,
 * including inside `node_modules` (any LLM SDK a future milestone
 * installs), a sibling milestone's own frozen directory, or outside the
 * repository entirely. Checking specifier TEXT was exactly the kind of
 * approximation this file's own header already warns against — the same
 * "cleverly parse a flexible surface" failure mode as `app/
 * milestones.test.ts`'s five-times-bypassed drift guard, one property
 * over: syntax was flexible, containment is the actual, unambiguous
 * property that matters.
 *
 * THE FIX: `resolvesInsideAllowedRoots(fromFile, specifier)` replaces
 * `isAllowedSpecifier(specifier)`. It resolves the specifier against the
 * IMPORTING FILE's real directory (`node:path`'s `resolve`, which fully
 * normalizes `..` segments — never a string-counting depth heuristic,
 * which this repo's own drift-guard history already shows is not robust)
 * and checks the resulting absolute path against an explicit, closed list
 * of allowed roots: `lib/simulate/` itself, and `lib/contracts/` (the one
 * frozen, already-audited dependency this milestone is allowed to use —
 * every real import in this codebase's own source targets one of these
 * two). Anything resolving outside both — `node_modules`, a sibling
 * milestone's `lib/reconcile`/`lib/rollback`, the repository root, outside
 * the repository — is rejected, regardless of how many `../` segments the
 * specifier's TEXT contains or how it's formatted. Prefix comparison uses
 * `root + sep` (never a bare `startsWith(root)`), so a sibling directory
 * that merely starts with the same characters — `lib/simulate-experimental`
 * against `lib/simulate` — cannot pass by string-prefix coincidence.
 *
 * FIX (independent verification, SECOND round): THE FIRST FIX CHECKED THE
 * TEXTUAL PATH, NOT THE REAL ONE — the same class of gap, one layer
 * deeper. `resolve()` is pure string arithmetic; it never dereferences a
 * symlink. So a REAL symlink placed inside `lib/simulate/` — e.g.
 * `lib/simulate/zz-attack-symlink` pointing at an arbitrary directory
 * outside the repository — made `resolvesInsideAllowedRoots(fromFile,
 * "./zz-attack-symlink/evil.js")` return `true`: the computed path's TEXT
 * starts with `SIMULATE_ROOT + sep`, so the textual check (correctly)
 * passed it, but Node's real module resolution DOES follow symlinks, so
 * this would actually load external code at runtime. Confirmed with a
 * real symlink (`ln -s`, not a synthetic string), not assumed. Git tracks
 * symlinks as ordinary repository objects, so one can land in a future
 * commit exactly like any other file.
 *
 * THE FIX: `resolvesToRealAllowedPath` (below) additionally
 * `realpathSync`s the resolved path and checks THAT against
 * `realpathSync`'d allowed roots — layered ON TOP OF the textual check,
 * never instead of it (see the three points below; the third is why both
 * checks stay). Three things had to be gotten right, each because a
 * naive `realpathSync` fix commonly gets it wrong:
 *
 * FIX (independent verification, THIRD round — a working bypass, not a
 * theoretical one): THE TOKENIZER TREATED A TEMPLATE LITERAL'S ENTIRE
 * BACKTICK SPAN — INCLUDING ANY `${...}` INTERPOLATION INSIDE IT — AS ONE
 * OPAQUE STRING, NEVER RE-ENTERING CODE MODE FOR WHAT IS ACTUALLY LIVE
 * CODE. Confirmed as a real, working evasion, not assumed:
 *
 *     export const x = `${await fetch("https://example.com")}`;
 *
 * passed this file's guard UNTOUCHED before this fix — `fetch(` sits
 * inside a `${...}` interpolation, and the old tokenizer's string-content
 * loop (below) copied everything between the opening and closing
 * backtick into `content` character-by-character with no awareness that
 * `${`...`}` is a boundary back into real, executable code. `codeTail`
 * (what `isBareFetchIdentifier` inspects) was never fed a single
 * character from inside the backticks, so the call was structurally
 * invisible to the scan. The exact same mechanism would just as happily
 * hide a `require(`/`import(` specifier assembled or written inside an
 * interpolation.
 *
 * THE FIX: `tokenize` is now RE-ENTRANT. A template literal's content is
 * scanned by `scanTemplateBody`, which — on hitting an actual, unescaped
 * `${` — calls straight back into the SAME code-scanning function
 * (`scanCode`, given an `isInterpolation` flag) to tokenize what is
 * inside the braces as genuine code: comments, strings, nested template
 * literals (recursively, to any depth), specifier contexts, and bare
 * `fetch(` calls are all detected there exactly as they would be
 * anywhere else in the file. `scanCode` returns control to
 * `scanTemplateBody` at the interpolation's own matching, depth-tracked
 * `}` (a plain brace counter scoped to that one call — `{`/`}` characters
 * inside a nested string/template/comment never touch it, because those
 * are fully consumed by their own recursive branches before the counter
 * is ever reached), so `${ {a: 1}.a }`-style nested braces do not end the
 * interpolation early. This is the same "re-enter code mode inside
 * `${...}`" fix applied to both this file and `domains/__tests__
 * /architecture.test.ts` (M6), which independently inherited the exact
 * same tokenizer shape and the exact same gap for its own `await`-ban —
 * see that file's header for its side of this fix.
 *
 * WHAT THIS FIX DOES AND DOES NOT COVER, STATED PLAINLY (see the
 * "teeth"/"false-positive discipline" blocks below for the direct proof
 * of each claim, not just this paragraph's word):
 *   - CAUGHT: `fetch(`, a non-relative specifier, or a specifier that
 *     escapes the allowed roots, written directly inside a `${...}`
 *     interpolation, at any nesting depth (an interpolation inside a
 *     nested template inside another interpolation, and so on).
 *   - STILL NOT CAUGHT, BY DESIGN, NOT OVERSIGHT: anything that never
 *     spells `fetch(` or a literal specifier string as CODE at all —
 *     `globalThis["fetch"]`, a destructured/aliased reference
 *     (`const f = fetch; f(url)`), a dynamically COMPUTED specifier
 *     (`import(someVariable)`, where nothing resolvable is ever a string
 *     literal in scan reach), or a keyword/URL typed out only inside an
 *     ORDINARY (non-interpolated) string/comment meant to be handed to
 *     `eval`/`Function(...)` later. Strings and comments stay
 *     deliberately opaque as DATA even after this fix — re-scanning their
 *     literal text for keywords is exactly the false-positive-prone
 *     "cleverly parse a flexible surface" failure this file's own header
 *     already argues against, and it is a different, unclosed gap from
 *     the one this fix closes (a live `${...}` re-entering real code,
 *     versus text that is never executed as code at all by this file's
 *     own static scan). A hand-rolled tokenizer is not a real parser; it
 *     is stated at exactly that strength, not oversold as airtight.
 *
 *   1. `realpathSync` THROWS on a path that does not exist — and every
 *      real, legitimate specifier in this codebase's own source ends in
 *      `.js` while pointing at a same-named `.ts` file on disk (this
 *      repo's NodeNext convention; `next.config.ts`'s own
 *      `extensionAlias` comment documents the same mapping), so the
 *      literal resolved path routinely does not exist under that exact
 *      name. FAIL CLOSED, deliberately, in the genuinely-unresolvable
 *      case: if the exact leaf does not exist, this falls back to
 *      realpath-ing its ENCLOSING DIRECTORY instead (safe, because a
 *      name that doesn't exist at all cannot itself be a symlink escaping
 *      anywhere — the only thing left to distrust is the directory it
 *      would live in, which a genuine import needs to actually exist
 *      regardless of the leaf's exact extension). If NEITHER the leaf nor
 *      its directory resolves to anything real, the specifier is
 *      REJECTED — never waved through just because this check couldn't
 *      pin down where it actually goes.
 *   2. THE ROOTS ARE REALPATH'D TOO, once, at module load
 *      (`REAL_ALLOWED_ROOTS` below) — comparing a realpath'd candidate
 *      against un-realpath'd roots would misfire the moment the
 *      repository itself sits under a symlink (common on macOS, where
 *      `/tmp` is itself a symlink to `/private/tmp`), producing a false
 *      rejection of a perfectly legitimate, correctly-contained file —
 *      a failure mode that LOOKS like a working guard while actually
 *      being simply wrong. Both sides of the comparison are normalized
 *      the same way, or the comparison means nothing.
 *   3. THE TEXTUAL CHECK STAYS — `resolvesInsideAllowedRoots` runs it
 *      FIRST and only proceeds to the realpath check if it passes. Two
 *      independent checks that can each fail on their own terms (one
 *      catching a `../` escape with no symlink involved at all, the
 *      other catching a symlink that textually looks contained) beat one
 *      clever combined one — this repo's own drift-guard history is the
 *      standing argument for why, paid for five times over already.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SIMULATE_ROOT = join(REPO_ROOT, "lib", "simulate");
const CONTRACTS_ROOT = join(REPO_ROOT, "lib", "contracts");
/** The closed list of directories a `lib/simulate/**` source file may resolve an import into — itself, and the one frozen dependency it is allowed to use. See the file header's "FIX" paragraph for why containment against THIS list, not specifier syntax, is the actual property being checked. */
const ALLOWED_ROOTS: readonly string[] = [SIMULATE_ROOT, CONTRACTS_ROOT];
/** The SAME roots, realpath'd once at module load — see the file header's "FIX (SECOND round)" point 2 for why comparing a realpath'd candidate against these un-normalized `ALLOWED_ROOTS` would be wrong: both sides of every real-path comparison must go through the identical normalization, or the comparison proves nothing. Computed eagerly, not defensively wrapped in try/catch: `lib/simulate/` and `lib/contracts/` not existing at all would mean this very test file couldn't have been found to run in the first place — a hard failure worth surfacing immediately, not a case to "fail closed" gracefully around. */
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
 * The four contexts (checked against the CODE immediately preceding a
 * string/template literal, never its contents) that make that literal a
 * module specifier rather than an ordinary string value — identical set
 * to `framework-free.test.ts`'s own, for the same reasons stated there.
 */
const SPECIFIER_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*$/,
  /\bimport\s*$/,
  /\bimport\s*\(\s*$/,
  /\brequire\s*\(\s*$/,
];

function isSpecifierContext(codeTail: string): boolean {
  return SPECIFIER_CONTEXT_PATTERNS.some((pattern) => pattern.test(codeTail));
}

/** True if a `fetch` identifier ending at the tail's end is a real, standalone call target — not `obj.fetch` (preceded by `.`) and not part of a longer identifier like `myFetch`/`_fetch`/`fetch2` (preceded/followed by an identifier character). The caller has already confirmed the character immediately after this tail is `(` before calling this. */
const BARE_FETCH_TAIL = /(?<![.\w$])fetch\s*$/;

function isBareFetchIdentifier(codeTail: string): boolean {
  return BARE_FETCH_TAIL.test(codeTail);
}

/**
 * Tokenizes `source` exactly the way `framework-free.test.ts` does (block/
 * line comments and ORDINARY string contents are opaque spans, never
 * re-scanned, never allowed to feed a context check on either side),
 * extended to ALSO watch for a bare `fetch(` call in the non-string,
 * non-comment code stream. One pass, two things collected, so both checks
 * see the exact same "what is really code" view of the file.
 *
 * RE-ENTRANT ACROSS `${...}` (see file header's "FIX (THIRD round)"): a
 * template literal's own content is scanned by `scanTemplateBody`, and
 * every `${` INSIDE it hands control straight back to `scanCode` — the
 * same function doing the top-level scan — so code hidden inside an
 * interpolation is tokenized as code, not skipped as string data, no
 * matter how deeply nested. `scanCode` and `scanTemplateBody` are mutual
 * recursion, not a linear pass, and both close over `specifiers`,
 * `bareFetchCalls`, and `line` so every call site accumulates into the
 * exact same result.
 */
function tokenize(source: string): { specifiers: readonly FoundSpecifier[]; bareFetchCalls: readonly FoundBareFetchCall[] } {
  const specifiers: FoundSpecifier[] = [];
  const bareFetchCalls: FoundBareFetchCall[] = [];
  const n = source.length;
  let line = 1;

  /**
   * Scans a template literal's contents, starting just AFTER its opening
   * backtick (`start`). Ordinary characters accumulate into `content`
   * (used for specifier text only when the whole template turns out to
   * have NO interpolation at all — identical in spirit to the old
   * `!content.includes("${")` guard, but now driven by an actual `${`
   * detection rather than a post-hoc substring search, so an escaped
   * `\${` that is not really an interpolation no longer over-excludes).
   * On a genuine, unescaped `${`, hands off to `scanCode(..., true)` to
   * tokenize the interpolation's own code — including, recursively, any
   * further nested template literal `scanCode` encounters there — then
   * resumes collecting template content after the matching `}`.
   */
  function scanTemplateBody(start: number): { nextIndex: number; content: string; sawInterpolation: boolean } {
    let i = start;
    let content = "";
    let sawInterpolation = false;

    while (i < n) {
      const c = source[i];
      if (c === "\\") {
        content += c + (source[i + 1] ?? "");
        if (source[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (c === "`") {
        i++; // step past the closing backtick.
        break;
      }
      if (c === "$" && source[i + 1] === "{") {
        sawInterpolation = true;
        i = scanCode(i + 2, true); // re-enter code mode for the interpolation's contents.
        i++; // step past the interpolation's own matching "}", which scanCode stopped AT rather than consumed.
        continue;
      }
      if (c === "\n") line++;
      content += c;
      i++;
    }

    return { nextIndex: i, content, sawInterpolation };
  }

  /**
   * The main tokenizing pass — also re-entered for a `${...}`
   * interpolation's own code (`isInterpolation: true`), in which case it
   * stops AT (without consuming) the interpolation's matching unmatched
   * `}` rather than running to end of source, so `scanTemplateBody` can
   * resume the surrounding template text right after it. `braceDepth`
   * tracks ONLY real, top-level-to-this-call `{`/`}` code characters
   * (any inside a nested string/template/comment are consumed whole by
   * their own branches below and never reach the counter), so a nested
   * object literal like `${ {a: 1}.a }` does not end the interpolation
   * at its own inner `}`.
   */
  function scanCode(start: number, isInterpolation: boolean): number {
    let i = start;
    let codeTail = "";
    let braceDepth = 0;

    while (i < n) {
      const c = source[i];
      const next = source[i + 1];

      if (isInterpolation && c === "}" && braceDepth === 0) {
        return i; // the interpolation's own closing brace — caller (scanTemplateBody) consumes it.
      }

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

      if (c === '"' || c === "'") {
        const quote = c;
        const startLine = line;
        const specifierPosition = isSpecifierContext(codeTail);

        let content = "";
        i++; // step past opening quote
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
        i++; // step past closing quote (or EOF, harmlessly)

        if (specifierPosition) specifiers.push({ specifier: content, line: startLine });

        codeTail = ""; // the string is consumed; nothing on its far side may combine with code from before it.
        continue;
      }

      if (c === "`") {
        const startLine = line;
        const specifierPosition = isSpecifierContext(codeTail);

        const { nextIndex, content, sawInterpolation } = scanTemplateBody(i + 1);
        i = nextIndex;

        if (specifierPosition && !sawInterpolation) {
          specifiers.push({ specifier: content, line: startLine });
        }

        codeTail = "";
        continue;
      }

      if (c === "(" && isBareFetchIdentifier(codeTail)) {
        bareFetchCalls.push({ line });
      }

      if (c === "{") braceDepth++;
      if (c === "}") braceDepth--;

      if (c === "\n") line++;
      codeTail = (codeTail + c).slice(-60);
      i++;
    }

    return i;
  }

  scanCode(0, false);
  return { specifiers, bareFetchCalls };
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
 * already passed the textual one — see the file header's "FIX (SECOND
 * round)" paragraph for the full argument on why this exists and the
 * three things it had to get right. Tries the exact resolved leaf first
 * (catches a symlink placed AT that exact name, whether a file or a
 * directory); if that name does not exist at all, falls back to the
 * enclosing directory (safe — a nonexistent name cannot itself be a
 * symlink, and the directory it would live in is what a genuine import
 * actually depends on existing); if NEITHER resolves to anything real,
 * fails closed.
 */
function resolvesToRealAllowedPath(resolved: string): boolean {
  try {
    return isRealPathContained(realpathSync(resolved));
  } catch {
    // Falls through to the directory-level attempt below — see this
    // function's own doc comment and the file header's point 1.
  }
  try {
    return isRealPathContained(realpathSync(dirname(resolved)));
  } catch {
    return false; // FAIL CLOSED: neither the leaf nor its enclosing directory resolves to anything real.
  }
}

/**
 * A specifier is allowed if and only if (1) it is syntactically relative
 * (`./...` or `../...` — a bare specifier like `"openai"` or `"node:fs"`
 * is rejected outright here, BEFORE any path resolution: `resolve()`
 * would otherwise happily treat a bare string as relative-to-`fromFile`
 * too, which is not how Node's real module resolution treats a bare
 * specifier, and would be the wrong question to ask of one anyway),
 * (2) resolving it against `fromFile`'s real directory lands TEXTUALLY
 * inside one of `ALLOWED_ROOTS` — see the file header's "FIX" paragraph
 * for the exact exploit this containment check exists to close, which a
 * syntax-only check (`specifier.startsWith("./")`) already missed once —
 * AND (3) that same resolved path ALSO lands inside the allowed roots
 * once symlinks are followed (`resolvesToRealAllowedPath`) — see the
 * file header's "FIX (SECOND round)" paragraph for the exploit THIS half
 * exists to close, which the textual check alone could not.
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
    const source = readFileSync(file, "utf8");
    const { specifiers, bareFetchCalls } = tokenize(source);
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

  describe("teeth: the same evasions that defeated the sibling's line-anchored guard, confirmed caught here", () => {
    it("a multi-line named import — the exact Prettier shape that defeated decision-engine's original matcher", () => {
      const source = ["import {", "  readFileSync,", "  writeFileSync,", '} from "node:fs";'].join("\n");
      const { specifiers } = tokenize(source);
      expect(specifiers).toEqual([{ specifier: "node:fs", line: 4 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("a template-literal dynamic import with no interpolation", () => {
      const { specifiers } = tokenize("const mod = await import(`openai`);");
      expect(specifiers).toEqual([{ specifier: "openai", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("a bare require()", () => {
      const { specifiers } = tokenize('const http = require("node:http");');
      expect(specifiers).toEqual([{ specifier: "node:http", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("a side-effect-only bare import", () => {
      const { specifiers } = tokenize('import "some-polyfill";');
      expect(specifiers).toEqual([{ specifier: "some-polyfill", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(false);
    });

    it("fetch called after whitespace, and fetch called with a preceding newline (both real reformatting shapes)", () => {
      expect(tokenize("fetch (url)").bareFetchCalls).toEqual([{ line: 1 }]);
      expect(tokenize("const x =\n  fetch(url)").bareFetchCalls).toEqual([{ line: 2 }]);
    });

    it("fetch reached via a template-literal-wrapped identifier is still a bare call, not a specifier — confirms the fetch scan and the specifier scan don't blind each other", () => {
      const source = 'const result = fetch(`https://example.com/${id}`);';
      expect(tokenize(source).bareFetchCalls).toEqual([{ line: 1 }]);
    });

    it("EXPLOIT REGRESSION (independent verification, THIRD round): a bare fetch(...) call hidden inside a template-literal ${...} interpolation is caught — this passed the guard UNTOUCHED before the re-entrant tokenizer fix", () => {
      const source = 'export const x = `${await fetch("https://example.com")}`;';
      const { bareFetchCalls } = tokenize(source);
      expect(bareFetchCalls).toEqual([{ line: 1 }]);
      // And end to end: this whole file (a fresh in-memory copy of the
      // real exploit, not a name-only assertion) really would be flagged.
      expect(bareFetchCalls.length).toBeGreaterThan(0);
    });

    it("EXPLOIT REGRESSION variant: a non-relative specifier hidden inside a ${...} interpolation (a dynamic import assembled inside the interpolation) is also caught", () => {
      const source = "export const x = `${(() => import(`openai`))()}`;";
      const { specifiers } = tokenize(source);
      expect(specifiers).toContainEqual({ specifier: "openai", line: 1 });
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "openai")).toBe(false);
    });

    it("EXPLOIT REGRESSION variant: fetch(...) nested two interpolations deep is still caught — proves the re-entry is recursive, not one level only", () => {
      const source = "export const x = `${`${await fetch(\"https://example.com\")}`}`;";
      const { bareFetchCalls } = tokenize(source);
      expect(bareFetchCalls).toEqual([{ line: 1 }]);
    });
  });

  describe("false-positive discipline: only real specifiers/calls, never identifiers, comments, or unrelated strings", () => {
    it("does NOT flag a relative import whose filename merely contains the word 'fetch'", () => {
      const { specifiers } = tokenize('import { helper } from "./fetchable-helpers.js";');
      expect(specifiers).toEqual([{ specifier: "./fetchable-helpers.js", line: 1 }]);
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, specifiers[0]!.specifier)).toBe(true);
    });

    it("does NOT flag `obj.fetch(...)` — a property access, not the global function", () => {
      expect(tokenize("cache.fetch(key)").bareFetchCalls).toEqual([]);
    });

    it("does NOT flag an identifier that merely contains 'fetch' as a substring, e.g. `refetchAll()` or `myFetcher()`", () => {
      expect(tokenize("refetchAll()").bareFetchCalls).toEqual([]);
      expect(tokenize("myFetcher()").bareFetchCalls).toEqual([]);
    });

    it("does NOT flag a comment that mentions fetch/openai/node: by name — comments are stripped, not scanned", () => {
      const source = [
        "// This module must never call fetch() or import openai or node:http.",
        "/* also never require('node-fetch') */",
        'import { helper } from "./helper.js";',
      ].join("\n");
      const { specifiers, bareFetchCalls } = tokenize(source);
      expect(specifiers).toEqual([{ specifier: "./helper.js", line: 3 }]);
      expect(bareFetchCalls).toEqual([]);
    });

    it('does NOT false-positive on this very file\'s own sanity-test strings, which embed literal "fetch(" and "from \\"openai\\"" text purely as DATA', () => {
      // This is the exact hazard framework-free.test.ts's header names by
      // name: a naive whole-file regex over raw text would find these
      // patterns inside the STRING LITERALS in this very describe block
      // and flag this file for violating the rule it tests. The line
      // below reproduces that hazard as an isolated check.
      const line = 'const example = \'const x = fetch("y"); import z from "openai";\';';
      const { specifiers, bareFetchCalls } = tokenize(line);
      expect(specifiers).toEqual([]); // the outer string is one opaque token; its own contents are never independently re-scanned.
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: a template literal containing the WORD 'await' as prose (no interpolation at all) is not flagged", () => {
      const source = 'const msg = `please await nothing here, it is just words`;';
      const { specifiers, bareFetchCalls } = tokenize(source);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: a benign NESTED template literal inside an interpolation is not flagged", () => {
      const source = "const msg = `outer ${`inner ${name} text`} more`;";
      const { specifiers, bareFetchCalls } = tokenize(source);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: an ordinary interpolation like `${count} items` is not flagged", () => {
      const source = "const label = `${count} items`;";
      const { specifiers, bareFetchCalls } = tokenize(source);
      expect(specifiers).toEqual([]);
      expect(bareFetchCalls).toEqual([]);
    });

    it("does NOT overtighten: a legitimate relative import specifier written inside a benign interpolation is still accepted, not merely un-flagged", () => {
      const source = "const mod = `${(() => import(`./adapter.js`))()}`;";
      const { specifiers } = tokenize(source);
      expect(specifiers).toContainEqual({ specifier: "./adapter.js", line: 1 });
      expect(resolvesInsideAllowedRoots(FROM_ADAPTER, "./adapter.js")).toBe(true);
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
