#!/usr/bin/env node
/**
 * RAA's deterministic, explicit file-by-file migration ledger.
 *
 * A file is never marked reviewed merely because an automated scan saw it.
 * Baseline is locked to the source commit; new files are distinct additions.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = resolve(root, "docs/reverse-architecting-file-ledger.jsonl");
const BASE = "fd9588089d089e7cb02d12178e34407d6f889f22";
const STATUSES = new Set([
  "pending",
  "reviewed-retained",
  "modified-verified",
  "new-verified",
  "deferred",
  "removed-verified",
]);

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "buffer" });

const phase = (path) => {
  if (path.startsWith("src/domain/")) return "01-domain";
  if (path.startsWith("src/contracts/")) return "02-contracts";
  if (path.startsWith("src/application/")) return "03-workflows";
  if (path.startsWith("src/composition/") || path.startsWith("src/server/"))
    return "04-composition-mcp";
  if (path.startsWith("src/cli/") || path.startsWith("src/cli"))
    return "05-cli";
  if (
    path.startsWith("src/") ||
    path.startsWith("bridge/") ||
    path.startsWith("native/")
  )
    return "06-providers";
  if (path.startsWith("tests/")) return "07-tests";
  if (
    path.startsWith("docs/") ||
    path.startsWith("website/") ||
    path.startsWith("README")
  )
    return "08-documentation";
  return "09-project-and-dependencies";
};

const load = () =>
  readFileSync(ledger, "utf8")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const save = (rows) => {
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeFileSync(
    ledger,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
};

const originalEntries = () =>
  git("ls-tree", "-r", "-z", BASE)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const meta = entry.slice(0, tab).split(" ");
      const path = entry.slice(tab + 1);
      return {
        path,
        base_sha: meta[2],
        kind: meta[1] === "commit" ? "gitlink" : "blob",
        phase: phase(path),
        status: "pending",
        note: "",
      };
    });

const worktreePaths = () =>
  git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

const command = process.argv[2] ?? "summary";

if (command === "init") {
  if (existsSync(ledger)) {
    console.error("Ledger exists. Refusing to overwrite file review history.");
    process.exitCode = 1;
  } else {
    const rows = originalEntries();
    const known = new Set(rows.map((row) => row.path));
    const paths = [...worktreePaths(), relative(root, ledger)];
    for (const path of paths) {
      if (known.has(path)) continue;
      known.add(path);
      rows.push({
        path,
        base_sha: null,
        kind: "new",
        phase: phase(path),
        status: "pending",
        note: "",
      });
    }
    save(rows);
    console.log(
      `Initialized ${rows.length} file-level decisions against ${BASE}`,
    );
  }
} else if (command === "mark") {
  const path = process.argv[3];
  const status = process.argv[4];
  const note = process.argv.slice(5).join(" ").trim();
  if (!path || !STATUSES.has(status) || !note) {
    console.error(
      "Usage: node scripts/raa-file-ledger.mjs mark <path> <status> <evidence/note>",
    );
    process.exitCode = 2;
  } else {
    const rows = load();
    const row = rows.find((entry) => entry.path === path);
    if (!row) {
      console.error("File is not in the pinned source inventory:", path);
      process.exitCode = 2;
    } else {
      row.status = status;
      row.note = note;
      save(rows);
      console.log(`${path}: ${status}`);
    }
  }
} else if (command === "check" || command === "summary" || command === "next") {
  const rows = load();
  const baseline = originalEntries();
  const actual = new Map(rows.map((row) => [row.path, row]));
  const missing = baseline
    .filter((row) => actual.get(row.path)?.base_sha !== row.base_sha)
    .map((row) => row.path);
  const newPaths = worktreePaths().filter((path) => !actual.has(path));
  if (missing.length > 0 || newPaths.length > 0) {
    console.error(
      JSON.stringify({
        missing_or_changed_baseline: missing,
        untracked_in_ledger: newPaths,
      }),
    );
    process.exitCode = 1;
  } else if (command === "check") {
    console.log(
      `Validated ${rows.length} records against ${baseline.length} source entries.`,
    );
  } else if (command === "next") {
    const next = rows
      .filter((row) => row.status === "pending")
      .sort(
        (a, b) =>
          a.phase.localeCompare(b.phase) || a.path.localeCompare(b.path),
      )
      .slice(0, 20);
    console.log(next.map((row) => `${row.phase}\t${row.path}`).join("\n"));
  } else {
    const counts = {};
    for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
    console.log(
      JSON.stringify(
        {
          source_commit: BASE,
          total_files: rows.length,
          source_files: baseline.length,
          new_files: rows.length - baseline.length,
          status: counts,
        },
        null,
        2,
      ),
    );
  }
} else {
  console.error(
    "Usage: node scripts/raa-file-ledger.mjs init|check|summary|next|mark",
  );
  process.exitCode = 2;
}
