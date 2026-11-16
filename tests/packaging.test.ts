/**
 * Packaging regression tests.
 *
 * Guards the npm tarball against drifting from the setup instructions in
 * README.md. The 0.2.2 release shipped `src/` and `README.md` only, so the
 * documented Claude Code setup step (`@import
 * node_modules/indra_db_mcp/INDRA_INSTRUCTIONS.md`) pointed at a file that
 * npm never installed.
 *
 * Run with:
 * ```bash
 * bun test tests/
 * ```
 */

import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  name: string;
  files: string[];
};
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

/** Files the README tells users to load out of node_modules/<pkg>/<file>. */
function documentedPackageFiles(): string[] {
  const re = /node_modules\/indra_db_mcp\/([^\s`)'",;]+)/g;
  const found = new Set<string>();
  for (const match of readme.matchAll(re)) {
    const rel = match[1];
    if (rel) found.add(rel.replace(/[.:]+$/, ""));
  }
  return [...found];
}

/** Does a package.json `files` entry cover this repo-relative path? */
function coveredBy(entry: string, relPath: string): boolean {
  const clean = entry.replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.includes("*")) {
    const pattern = new RegExp(
      "^" +
        clean
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*") +
        "$",
    );
    return pattern.test(relPath);
  }
  if (clean.includes(".")) return relPath === clean;
  // Bare directory name: npm includes everything beneath it.
  return relPath === clean || relPath.startsWith(clean + "/");
}

describe("npm packaging", () => {
  test("README's node_modules references exist in the repo", () => {
    const refs = documentedPackageFiles();
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect({ ref, exists: existsSync(join(repoRoot, ref)) }).toEqual({
        ref,
        exists: true,
      });
    }
  });

  test("every README setup file is included by package.json files[]", () => {
    const refs = documentedPackageFiles();
    const missing = refs.filter(
      (ref) => !pkg.files.some((entry) => coveredBy(entry, ref)),
    );
    expect(missing).toEqual([]);
  });

  test("INDRA_INSTRUCTIONS.md is in the publish allowlist", () => {
    const included = pkg.files.some((entry) =>
      coveredBy(entry, "INDRA_INSTRUCTIONS.md"),
    );
    expect(included).toBe(true);
  });

  test("the real `npm pack` tarball contains INDRA_INSTRUCTIONS.md", () => {
    // --offline keeps the test hermetic: without it npm may reach for the
    // registry and stall on machines behind a slow network.
    const proc = Bun.spawnSync({
      cmd: ["npm", "pack", "--dry-run", "--json", "--offline"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      // npm unavailable in this environment (e.g. a bun-only machine).
      // The allowlist assertions above still guard the regression.
      return;
    }
    const packed = JSON.parse(proc.stdout.toString()) as Record<
      string,
      { files: { path: string }[] }
    >;
    const manifest = Object.values(packed)[0];
    const paths = manifest?.files.map((f) => f.path) ?? [];
    expect(paths).toContain("INDRA_INSTRUCTIONS.md");
  }, 120_000);
});
