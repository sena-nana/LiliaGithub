#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const outputPath = path.join(repoRoot, "src/services/workspace/generatedCommands.ts");
const checkOnly = process.argv.includes("--check");

const result = spawnSync(
  "cargo",
  [
    "run",
    "--quiet",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "-p",
    "lilia_github_workspace",
    "--example",
    "workspace_command_manifest",
  ],
  { cwd: repoRoot, encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const manifest = JSON.parse(result.stdout);
validateManifest(manifest);
const source = renderManifest(manifest);

if (checkOnly) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== source) {
    console.error("Workspace command manifest is stale. Run yarn commands:generate.");
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(outputPath, source);
console.log(`Updated ${path.relative(repoRoot, outputPath)}.`);

function validateManifest(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Workspace command registry is empty.");
  }
  const names = new Set();
  for (const entry of value) {
    if (!entry || typeof entry.command !== "string" || typeof entry.domain !== "string") {
      throw new Error("Workspace command registry contains an invalid entry.");
    }
    if (names.has(entry.command)) throw new Error(`Duplicate workspace command: ${entry.command}`);
    names.add(entry.command);
  }
}

function renderManifest(entries) {
  const rows = entries
    .map(({ command, domain }) => `  ${JSON.stringify(command)}: { command: ${JSON.stringify(command)}, domain: ${JSON.stringify(domain)} },`)
    .join("\n");
  return `// Generated from the Rust workspace command registry. Do not edit by hand.\n\nexport const WORKSPACE_COMMAND_MANIFEST = {\n${rows}\n} as const;\n\nexport type GeneratedWorkspaceCommandName = keyof typeof WORKSPACE_COMMAND_MANIFEST;\nexport type WorkspaceCommandDomain = typeof WORKSPACE_COMMAND_MANIFEST[GeneratedWorkspaceCommandName]["domain"];\n`;
}
