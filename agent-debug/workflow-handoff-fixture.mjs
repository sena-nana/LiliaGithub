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
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const invocationLogPath = ${JSON.stringify(fixture.invocationsPath)};
const countPath = invocationLogPath + ".count";
const handoffFlagIndex = process.argv.indexOf("--task-handoff");
const endpointDir = path.join(tmpdir(), "lilia-code-ipc");
const endpointPath = path.join(endpointDir, "lilia-code-v1.endpoint.json");
const token = "focused-workflow-token";

function nextInvocation() {
  let invocation = 1;
  try { invocation = Number.parseInt(readFileSync(countPath, "utf8"), 10) + 1; } catch {}
  writeFileSync(countPath, String(invocation), "utf8");
  return invocation;
}

function taskReceipt(payload, invocation) {
  return invocation === 1
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
}

function recordInvocation(payload, receipt, extra = {}) {
  const invocation = nextInvocation();
  appendFileSync(
    invocationLogPath,
    JSON.stringify({ invocation, payload, receipt, ...extra }) + "\\n",
    "utf8",
  );
  return invocation;
}

if (handoffFlagIndex >= 0) {
  const payloadPath = process.argv[handoffFlagIndex + 1];
  if (!payloadPath) process.exit(2);
  const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  const invocation = (() => {
    try { return Number.parseInt(readFileSync(countPath, "utf8"), 10) + 1; } catch { return 1; }
  })();
  const receipt = taskReceipt(payload, invocation);
  writeFileSync(payloadPath + ".receipt.json", JSON.stringify(receipt, null, 2) + "\\n", "utf8");
  recordInvocation(payload, receipt, { payloadPath, transport: "recovery-cli" });
} else {
  const server = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32BE(0);
      if (buffered.length < length + 4) return;
      const request = JSON.parse(buffered.subarray(4, length + 4).toString("utf8"));
      const invocation = (() => {
        try { return Number.parseInt(readFileSync(countPath, "utf8"), 10) + 1; } catch { return 1; }
      })();
      const receipt = taskReceipt(request.handoff, invocation);
      const response = {
        protocol: "lilia-code-ipc",
        version: 1,
        requestId: request.requestId,
        status: receipt.status,
        taskId: receipt.taskId ?? null,
        projectId: receipt.projectId ?? null,
        resultRoute: receipt.resultRoute ?? null,
        error: receipt.error ?? null,
      };
      recordInvocation(request.handoff, receipt, { transport: "ipc" });
      const payload = Buffer.from(JSON.stringify(response), "utf8");
      const frame = Buffer.allocUnsafe(payload.length + 4);
      frame.writeUInt32BE(payload.length, 0);
      payload.copy(frame, 4);
      socket.end(frame);
      if (invocation >= 2) {
        setTimeout(() => server.close(() => {
          rmSync(endpointPath, { force: true });
        }), 50);
      }
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") process.exit(3);
    mkdirSync(endpointDir, { recursive: true });
    const pendingPath = endpointPath + ".pending";
    writeFileSync(pendingPath, JSON.stringify({
      protocol: "lilia-code-ipc",
      version: 1,
      port: address.port,
      instanceId: "focused-workflow-instance",
      token,
      pid: process.pid,
      startedAt: String(Date.now()),
    }), "utf8");
    renameSync(pendingPath, endpointPath);
  });
}
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
