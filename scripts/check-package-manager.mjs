#!/usr/bin/env node

import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const requiredPackageManager = packageJson.packageManager;
const userAgent = process.env.npm_config_user_agent ?? "";

const pnpmMatch = userAgent.match(/\bpnpm\/([^\s]+)/);
const pnpmVersion = pnpmMatch?.[1];
const pnpmMajor = Number.parseInt(pnpmVersion?.split(".")[0] ?? "", 10);

if (pnpmMajor >= 11) {
  process.exit(0);
}

const reason = pnpmVersion
  ? `Detected pnpm ${pnpmVersion}.`
  : userAgent
    ? `Detected package manager: ${userAgent}.`
    : "Could not detect the active package manager.";

console.error(formatMessage(reason));
process.exit(1);

function formatMessage(reason) {
  return [
    "",
    "LiliaGithub requires pnpm 4 through Corepack.",
    reason,
    "",
    `Expected package manager: ${requiredPackageManager}`,
    "",
    "Fix:",
    "  npm install --global corepack@0.35.0",
    "  corepack enable pnpm",
    "  pnpm install",
    "",
    "If the `pnpm` command still resolves to pnpm 1, run the commands through Corepack:",
    "  pnpm install",
    "  pnpm dev",
    "",
  ].join("\n");
}
