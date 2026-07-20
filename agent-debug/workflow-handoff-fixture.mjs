import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function workflowHandoffFixturePaths(runDir) {
  return {
    tempDir: path.join(runDir, "temp"),
    shimBinDir: path.join(runDir, "liliacode-shim-bin"),
    invocationsPath: path.join(runDir, "liliacode-shim-invocations.jsonl"),
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function prepareLiliaCodeShim(fixture) {
  await mkdir(fixture.shimBinDir, { recursive: true });
  await mkdir(fixture.tempDir, { recursive: true });
  const shimScriptPath = path.join(fixture.shimBinDir, "liliacode-shim.mjs");
  const shimSource = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const invocationLogPath = ${JSON.stringify(fixture.invocationsPath)};
const countPath = invocationLogPath + ".count";
const handoffFlagIndex = process.argv.indexOf("--task-handoff");
if (handoffFlagIndex < 0 || !process.argv[handoffFlagIndex + 1]) process.exit(2);
const payloadPath = process.argv[handoffFlagIndex + 1];
const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
let invocation = 1;
try { invocation = Number.parseInt(readFileSync(countPath, "utf8"), 10) + 1; } catch {}
writeFileSync(countPath, String(invocation), "utf8");
const receipt = invocation === 1
  ? {
      protocol: "lilia-code-task-handoff",
      version: 1,
      handoffId: payload.id,
      status: "incompatible",
      error: "Focused replay compatibility rejection",
      updatedAt: String(Date.now()),
    }
  : {
      protocol: "lilia-code-task-handoff",
      version: 1,
      handoffId: payload.id,
      status: "accepted",
      taskId: "focused-workflow-task",
      projectId: "focused-workflow-project",
      resultRoute: "/projects/focused-workflow-project/tasks/focused-workflow-task",
      updatedAt: String(Date.now()),
    };
writeFileSync(payloadPath + ".receipt.json", JSON.stringify(receipt, null, 2) + "\\n", "utf8");
appendFileSync(invocationLogPath, JSON.stringify({ invocation, payloadPath, payload, receipt }) + "\\n", "utf8");
`;
  await writeFile(shimScriptPath, shimSource.trimStart(), "utf8");

  if (process.platform === "win32") {
    await writeFile(
      path.join(fixture.shimBinDir, "liliacode.cmd"),
      `@echo off\r\n${JSON.stringify(process.execPath)} ${JSON.stringify(shimScriptPath)} %*\r\n`,
      "utf8",
    );
    return;
  }

  const launcherPath = path.join(fixture.shimBinDir, "liliacode");
  await writeFile(
    launcherPath,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(shimScriptPath)} "$@"\n`,
    "utf8",
  );
  await chmod(launcherPath, 0o755);
}

async function readInvocations(invocationsPath) {
  try {
    const content = await readFile(invocationsPath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function waitForLiliaCodeShimInvocations(invocationsPath, expectedCount, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const invocations = await readInvocations(invocationsPath);
    if (invocations.length >= expectedCount) return invocations;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`LiliaCode shim did not receive ${expectedCount} invocations within ${timeoutMs}ms.`);
}

export function assertWorkflowHandoffPayload(payload, { repoRoot, expectedRoute, expectedRunId }) {
  if (payload?.kind !== "workflowFailure") throw new Error("Focused replay did not create a workflowFailure handoff.");
  if (payload?.repository?.worktreePath !== repoRoot) {
    throw new Error(`Focused replay used an unexpected worktree: ${payload?.repository?.worktreePath ?? "missing"}`);
  }
  if (payload?.repository?.branch !== "main" || !payload?.repository?.remoteUrl) {
    throw new Error("Focused replay handoff is missing the matched branch or remote repository context.");
  }
  if (payload?.source?.route !== expectedRoute || payload?.source?.objectUrl !== payload?.workflow?.runUrl) {
    throw new Error("Focused replay handoff did not preserve the exact Actions return route and run URL.");
  }
  if (payload?.workflow?.runId !== expectedRunId || !payload?.workflow?.workflowName) {
    throw new Error("Focused replay handoff is missing the Workflow run identity.");
  }
  if (!payload?.relatedFiles?.includes(".github/workflows/ci.yml")) {
    throw new Error("Focused replay handoff is missing the Workflow definition path.");
  }
  if (!payload?.logSummary?.trim()) throw new Error("Focused replay handoff is missing diagnostic logs.");
}
