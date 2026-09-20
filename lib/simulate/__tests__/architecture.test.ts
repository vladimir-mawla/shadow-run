import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SIMULATE_ROOT = join(REPO_ROOT, "lib", "simulate");

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
 * line comments and string/template-literal CONTENTS are opaque spans,
 * never re-scanned, never allowed to feed a context check on either
 * side), extended to ALSO watch for a bare `fetch(` call in the non-
 * string, non-comment code stream. One pass, two things collected, so
 * both checks see the exact same "what is really code" view of the file.
 */
function tokenize(source: string): { specifiers: readonly FoundSpecifier[]; bareFetchCalls: readonly FoundBareFetchCall[] } {
  const specifiers: FoundSpecifier[] = [];
  const bareFetchCalls: FoundBareFetchCall[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let codeTail = "";

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

      if (specifierPosition && !content.includes("${")) {
        specifiers.push({ specifier: content, line: startLine });
      }

      codeTail = ""; // the string is consumed; nothing on its far side may combine with code from before it.
      continue;
    }

    if (c === "(" && isBareFetchIdentifier(codeTail)) {
      bareFetchCalls.push({ line });
    }

    if (c === "\n") line++;
    codeTail = (codeTail + c).slice(-60);
    i++;
  }

  return { specifiers, bareFetchCalls };
}

/** A specifier is allowed if and only if it is relative (`./...` or `../...`) — see file header for why this is an allowlist, not an enumerated denylist. Every bare/absolute specifier — `node:fs`, `fs`, `openai`, `node-fetch`, `react`, a scoped package, anything not starting with a dot — is forbidden by this one rule, with no per-package list to keep current. */
function isAllowedSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
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
      if (!isAllowedSpecifier(specifier)) {
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
  it("every import/require specifier in non-test source is relative — no bare package, no node: built-in, no absolute path", () => {
    const { specifierOffenders } = scan();
    if (specifierOffenders.length > 0) {
      const report = specifierOffenders.map((o) => `${o.file}:${o.line}: imports "${o.specifier}"`).join("\n");
      throw new Error(
        `lib/simulate/** may only import via a relative specifier (./ or ../) — found ${specifierOffenders.length} ` +
          `non-relative import(s), which is exactly how an LLM client, a network library, or a Node built-in would ` +
          `enter this milestone's frozen boundary:\n${report}`,
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

  describe("sanity: the allowlist rule itself", () => {
    it("accepts relative specifiers", () => {
      expect(isAllowedSpecifier("./path.js")).toBe(true);
      expect(isAllowedSpecifier("../contracts/index.js")).toBe(true);
    });

    it("rejects every non-relative shape, with no enumeration needed", () => {
      expect(isAllowedSpecifier("node:fs")).toBe(false);
      expect(isAllowedSpecifier("fs")).toBe(false);
      expect(isAllowedSpecifier("openai")).toBe(false);
      expect(isAllowedSpecifier("@anthropic-ai/sdk")).toBe(false);
      expect(isAllowedSpecifier("node-fetch")).toBe(false);
      expect(isAllowedSpecifier("react")).toBe(false);
      // A package nobody on this project has ever heard of — the exact
      // case an enumerated denylist can never cover, and this rule
      // rejects it anyway, for free, because it isn't relative.
      expect(isAllowedSpecifier("some-llm-sdk-invented-tomorrow")).toBe(false);
    });
  });

  describe("teeth: the same evasions that defeated the sibling's line-anchored guard, confirmed caught here", () => {
    it("a multi-line named import — the exact Prettier shape that defeated decision-engine's original matcher", () => {
      const source = ["import {", "  readFileSync,", "  writeFileSync,", '} from "node:fs";'].join("\n");
      const { specifiers } = tokenize(source);
      expect(specifiers).toEqual([{ specifier: "node:fs", line: 4 }]);
      expect(isAllowedSpecifier(specifiers[0]!.specifier)).toBe(false);
    });

    it("a template-literal dynamic import with no interpolation", () => {
      const { specifiers } = tokenize("const mod = await import(`openai`);");
      expect(specifiers).toEqual([{ specifier: "openai", line: 1 }]);
      expect(isAllowedSpecifier(specifiers[0]!.specifier)).toBe(false);
    });

    it("a bare require()", () => {
      const { specifiers } = tokenize('const http = require("node:http");');
      expect(specifiers).toEqual([{ specifier: "node:http", line: 1 }]);
      expect(isAllowedSpecifier(specifiers[0]!.specifier)).toBe(false);
    });

    it("a side-effect-only bare import", () => {
      const { specifiers } = tokenize('import "some-polyfill";');
      expect(specifiers).toEqual([{ specifier: "some-polyfill", line: 1 }]);
      expect(isAllowedSpecifier(specifiers[0]!.specifier)).toBe(false);
    });

    it("fetch called after whitespace, and fetch called with a preceding newline (both real reformatting shapes)", () => {
      expect(tokenize("fetch (url)").bareFetchCalls).toEqual([{ line: 1 }]);
      expect(tokenize("const x =\n  fetch(url)").bareFetchCalls).toEqual([{ line: 2 }]);
    });

    it("fetch reached via a template-literal-wrapped identifier is still a bare call, not a specifier — confirms the fetch scan and the specifier scan don't blind each other", () => {
      const source = 'const result = fetch(`https://example.com/${id}`);';
      expect(tokenize(source).bareFetchCalls).toEqual([{ line: 1 }]);
    });
  });

  describe("false-positive discipline: only real specifiers/calls, never identifiers, comments, or unrelated strings", () => {
    it("does NOT flag a relative import whose filename merely contains the word 'fetch'", () => {
      const { specifiers } = tokenize('import { helper } from "./fetchable-helpers.js";');
      expect(specifiers).toEqual([{ specifier: "./fetchable-helpers.js", line: 1 }]);
      expect(isAllowedSpecifier(specifiers[0]!.specifier)).toBe(true);
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

    it("does not false-positive on ordinary relative imports already used throughout this milestone", () => {
      const specifiers = ["./path.js", "../contracts/index.js", "./action.js", "./adapter.js"];
      for (const specifier of specifiers) {
        expect(isAllowedSpecifier(specifier)).toBe(true);
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
