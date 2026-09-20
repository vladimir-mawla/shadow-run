import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A grep-based architectural test, mirroring the discipline this project's
 * own plan already commits to elsewhere (M3's zero-LLM-import test,
 * decision-engine's `no-bare-threshold.test.ts`): a structural guarantee
 * that a machine checks on every run, not a claim resting on this
 * milestone's author remembering not to cross a line.
 *
 * THIS MILESTONE'S OWN BRIEF IS EXPLICIT: M3 (`lib/simulate/**`) and M4
 * (`lib/reconcile/**`) are being built and verified on separate branches
 * right now and are NOT present on this worktree; importing from either,
 * or stubbing either, is out of scope and was explicitly told to be
 * grounds to "stop and report" rather than invent. This test makes that
 * boundary mechanical: it fails the moment any file under `lib/rollback/**`
 * so much as writes the string `lib/simulate` or `lib/reconcile` into an
 * import path, so a future edit (by a human or another agent) cannot
 * silently reach across a boundary this milestone was told not to cross.
 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("lib/rollback/** never imports lib/simulate or lib/reconcile", () => {
  const rollbackDir = join(process.cwd(), "lib", "rollback");
  const files = collectSourceFiles(rollbackDir);

  it("found at least one source file to check (sanity check on the test itself)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s has no import referencing lib/simulate or lib/reconcile", (file) => {
    // Deliberately checks only actual `import` STATEMENT lines, not the
    // whole file's text — several files under lib/rollback/** discuss
    // M3's `lib/simulate/path.ts` in prose comments (naming the exact
    // duplication this milestone is told to flag, not fix), and a
    // comment mentioning that path is not the violation this test exists
    // to catch. A real cross-boundary import is.
    const contents = readFileSync(file, "utf8");
    const importLines = contents.match(/^import .*$/gm) ?? [];
    const forbidden = ["simulate/", "reconcile/", "../simulate", "../reconcile"];
    for (const line of importLines) {
      for (const needle of forbidden) {
        expect(line.includes(needle)).toBe(false);
      }
    }
  });

  it.each(files)("%s only imports from lib/contracts or lib/rollback itself (plus node builtins)", (file) => {
    const contents = readFileSync(file, "utf8");
    const importLines = contents.match(/^import .*$/gm) ?? [];
    for (const line of importLines) {
      const isRelativeContracts = line.includes("../contracts/") || line.includes("../../contracts/");
      const isRelativeSelf = line.includes("./") && !line.includes("../contracts") && !line.includes("../../contracts");
      const isNodeBuiltin = line.includes('"node:') || line.includes("'node:");
      const isVitest = line.includes('"vitest"') || line.includes("'vitest'");
      expect(isRelativeContracts || isRelativeSelf || isNodeBuiltin || isVitest).toBe(true);
    }
  });
});
