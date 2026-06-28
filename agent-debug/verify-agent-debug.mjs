import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const runsRoot = path.join(repoRoot, "agent-debug-runs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(runsRoot, runId);
const appDataDir = path.join(runDir, "app-data");
const webviewDataDir = path.join(runDir, "webview-data");
const driverPort = Number.parseInt(process.env.LILIA_GITHUB_AGENT_DEBUG_DRIVER_PORT ?? "4444", 10);
const driverUrl = `http://127.0.0.1:${driverPort}`;
const defaultDevUrl = "http://localhost:1420";
const explicitDevUrl = Boolean(process.env.LILIA_GITHUB_AGENT_DEBUG_DEV_URL);
const explicitAppBinary = Boolean(process.env.LILIA_GITHUB_AGENT_DEBUG_APP);
let devUrl = process.env.LILIA_GITHUB_AGENT_DEBUG_DEV_URL ?? defaultDevUrl;
const appBinary = process.env.LILIA_GITHUB_AGENT_DEBUG_APP ?? defaultAppBinary();
const localViteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const replay = [];
const observedSnapshots = [];

const agentDebugEnv = {
  LILIA_GITHUB_AGENT_DEBUG: "1",
  VITE_LILIA_GITHUB_AGENT_DEBUG: "1",
  VITE_LILIA_GITHUB_AGENT_DEBUG_MOCK_WORKSPACE: "1",
  WEBVIEW2_USER_DATA_FOLDER: webviewDataDir,
  MSEDGEDRIVER_TELEMETRY_OPTOUT: "1",
  ...(process.platform === "win32"
    ? { APPDATA: appDataDir, LOCALAPPDATA: appDataDir }
    : { XDG_CONFIG_HOME: appDataDir, XDG_DATA_HOME: appDataDir }),
};

function defaultAppBinary() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    path.join(repoRoot, "src-tauri", "target", "debug", `lilia_github${exe}`),
    path.join(repoRoot, "src-tauri", "target", "debug", `lilia-github${exe}`),
    path.join(repoRoot, "src-tauri", "target", "debug", `LiliaGithub${exe}`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function parsePortFromUrl(url) {
  const parsed = new URL(url);
  if (parsed.port) return Number.parseInt(parsed.port, 10);
  return parsed.protocol === "https:" ? 443 : 80;
}

function canListen(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error) => {
      resolve(error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL");
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ host, port });
  });
}

async function isLocalPortAvailable(port) {
  return (await canListen("127.0.0.1", port)) && (await canListen("::1", port));
}

async function findAvailableDevUrl(startPort) {
  for (let port = startPort; port < 65536; port += 1) {
    if (await isLocalPortAvailable(port)) return `http://localhost:${port}`;
  }
  throw new Error(`No available localhost port found from ${startPort}.`);
}

function getUrl(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) resolve();
        else reject(new Error(`GET ${url} failed: ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    req.setTimeout(1000, () => req.destroy(new Error(`GET ${url} timed out`)));
  });
}

function getUrlText(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) resolve(text);
        else reject(new Error(`GET ${url} failed: ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    req.setTimeout(1000, () => req.destroy(new Error(`GET ${url} timed out`)));
  });
}

async function isUrlReady(url) {
  try {
    await getUrl(url);
    return true;
  } catch {
    return false;
  }
}

async function devUrlHasLiliaGithub(url) {
  try {
    const text = await getUrlText(url);
    return /<title>\s*LiliaGithub\s*<\/title>/i.test(String(text)) || String(text).includes("lilia-github");
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs, label, child = null, output = []) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited before ready: ${output.join("").trim() || child.exitCode}`);
    }
    if (await isUrlReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

function request(method, pathname, body) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${driverUrl}${pathname}`,
      {
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* Keep raw text in the error below. */
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${method} ${pathname} failed: ${res.statusCode} ${text}`));
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function writeJson(name, value) {
  const target = path.join(runDir, name);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

function safeArtifactName(label) {
  return label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function formatMissingAgentIds(missingAgentIds) {
  return missingAgentIds
    .slice(0, 10)
    .map((item) => {
      const label = item.text || item.selector || item.tagName;
      const nearest = item.nearestAgentId ? ` nearest=${item.nearestAgentId}` : "";
      return `${item.role} ${label}${nearest}`;
    })
    .join("; ");
}

export function assertNoMissingAgentIds(observe, label) {
  const missingAgentIds = observe?.missingAgentIds ?? [];
  if (!missingAgentIds.length) return;
  const suffix = missingAgentIds.length > 10 ? `; +${missingAgentIds.length - 10} more` : "";
  throw new Error(`${label} has ${missingAgentIds.length} missing agent ids: ${formatMissingAgentIds(missingAgentIds)}${suffix}`);
}

function stopProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill();
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => {
      const text = output.join("");
      if (code === 0) resolve(text);
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${text}`));
    });
  });
}

async function buildDebugAppForDevUrl(targetDevUrl) {
  const configPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.build = {
    ...config.build,
    devUrl: targetDevUrl,
  };

  return run(
    "cargo",
    ["build", "--manifest-path", path.join(repoRoot, "src-tauri", "Cargo.toml")],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        TAURI_CONFIG: JSON.stringify(config),
      },
    },
  );
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await request("GET", "/status");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("tauri-driver did not become ready within 15s");
}

async function execute(sessionId, script, args = []) {
  const result = await request("POST", `/session/${sessionId}/execute/sync`, { script, args });
  return result?.value;
}

async function waitForDebugApi(sessionId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await execute(
      sessionId,
      "return Boolean(window.__liliaGithubAgentDebug?.observe?.().enabled || window.__liliaAgentDebug?.observe?.().enabled);",
    ).catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Agent debug API did not become enabled within 30s");
}

async function waitForDebugUi(sessionId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await execute(
      sessionId,
      `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
       const observe = api?.observe?.();
       return Boolean(observe?.elements?.some((element) =>
         element.id === "app.shell" ||
         element.id === "setup.screen" ||
         element.id === "sidebar" ||
         element.id === "titlebar"
       ));`,
    ).catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("agent debug UI tree did not become ready within 30s");
}

async function waitForAgentDebugCondition(sessionId, script, args, errorMessage, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const present = await execute(sessionId, script, args).catch(() => false);
    if (present) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(errorMessage);
}

async function waitForAgentElement(sessionId, target, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     const observe = api?.observe?.();
     return Boolean(observe?.elements?.some((element) => element.id === arguments[0] && element.visible));`,
    [target],
    `Agent debug target did not become visible: ${target}`,
    timeoutMs,
  );
}

async function waitForAgentElementPrefix(sessionId, prefix, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     const observe = api?.observe?.();
     return Boolean(observe?.elements?.some((element) => element.id.startsWith(arguments[0]) && element.visible));`,
    [prefix],
    `Agent debug target prefix did not become visible: ${prefix}`,
    timeoutMs,
  );
}

async function waitForRouteIncludes(sessionId, routePart, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     const observe = api?.observe?.();
     return Boolean(observe?.route?.includes(arguments[0]));`,
    [routePart],
    `Agent debug route did not include: ${routePart}`,
    timeoutMs,
  );
}

async function clickAgentTarget(sessionId, target) {
  await waitForAgentElement(sessionId, target);
  const result = await execute(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     return api.act({ type: 'click', target: arguments[0] });`,
    [target],
  );
  replay.push({ type: "click", target });
  return result;
}

async function observeAgentStep(sessionId, label) {
  const observe = await execute(
    sessionId,
    "const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug; return api?.observe?.() ?? null;",
  );
  if (!observe?.enabled) throw new Error(`Agent debug API is not enabled during ${label}`);
  if (!observe.elements?.length) throw new Error(`Agent debug snapshot for ${label} has no addressable elements`);
  const observePath = await writeJson(`observe-${safeArtifactName(label)}.json`, observe);
  const missingPath = await writeJson(`missing-agent-ids-${safeArtifactName(label)}.json`, observe.missingAgentIds ?? []);
  observedSnapshots.push({
    label,
    route: observe.route,
    elementCount: observe.elements.length,
    missingAgentIdCount: observe.missingAgentIds?.length ?? 0,
    observePath,
    missingPath,
  });
  assertNoMissingAgentIds(observe, label);
  replay.push({ type: "observe", label, route: observe.route, elementCount: observe.elements.length });
  return observe;
}

async function runRegressionFlow(sessionId) {
  const steps = [
    {
      observe: "home-overview",
      waits: ["home.page", "home.overview.search"],
    },
    {
      clicks: ["sidebar.repo.LiliaGithub-linked-worktree"],
      waits: ["repo.project.sidebar.release"],
      observe: "linked-worktree-repo",
    },
    {
      clicks: ["repo.toolbar.tab.files"],
      routeIncludes: ["/files"],
      observe: "repo-files",
    },
    {
      clicks: ["repo.toolbar.tab.changes"],
      routeIncludes: ["/changes"],
      waits: ["repo.changes.commit.message"],
      observe: "repo-changes",
    },
    {
      clicks: ["repo.toolbar.tab.history"],
      routeIncludes: ["/history"],
      waitPrefixes: ["repo.history.commit."],
      observe: "repo-history",
    },
    {
      clicks: ["repo.toolbar.tab.stash"],
      routeIncludes: ["/stash"],
      observe: "repo-stash",
    },
    {
      clicks: ["repo.toolbar.tab.repo"],
      waits: ["repo.project.sidebar.milestones"],
      observe: "repo-readme-about",
    },
    {
      clicks: ["repo.project.sidebar.milestones"],
      waits: ["repo.milestones.search", "repo.milestones.refresh"],
      observe: "project-milestones",
    },
    {
      clicks: ["repo.project.sidebar.issues"],
      waits: ["repo.issues.create", "repo.issues.sidebar.create"],
      observe: "issues-panel",
    },
    {
      clicks: ["repo.issues.create"],
      waits: ["repo.issues.form.title"],
      observe: "issue-create-form",
      after: ["repo.issues.form.cancel"],
    },
    {
      clicks: ["repo.project.sidebar.pulls"],
      waits: ["repo.pulls.create", "repo.pulls.sidebar.create"],
      observe: "pulls-panel",
    },
    {
      clicks: ["repo.pulls.create"],
      waits: ["repo.pulls.form.title"],
      observe: "pull-create-form",
      after: ["repo.pulls.form.cancel"],
    },
    {
      clicks: ["repo.project.sidebar.actions"],
      waits: ["repo.actions.refresh", "repo.actions.sidebar.refresh"],
      observe: "actions-panel",
    },
    {
      clicks: ["repo.project.sidebar.release"],
      waits: ["repo.release.refresh", "repo.release.filters.type.prerelease"],
      observe: "release-panel",
    },
    {
      clicks: ["repo.release.filters.type.prerelease", "repo.release.filters.tag.v1.0.0-beta", "repo.release.create"],
      waits: ["repo.release.form.tag"],
      observe: "release-create-form",
      after: ["repo.release.form.close"],
    },
    {
      clicks: ["repo.project.sidebar.settings"],
      waits: ["repo.settings.form"],
      observe: "repo-settings",
    },
    {
      clicks: ["sidebar.footer.settings", "settings.sidebar.appearance"],
      waits: ["settings.appearance.theme.dark", "settings.appearance.corner.radius"],
      observe: "settings-appearance",
    },
    {
      clicks: ["settings.sidebar.repositories"],
      waits: ["settings.repositories.github.bind", "settings.repositories.create-remote"],
      observe: "settings-repositories",
    },
    {
      clicks: ["settings.sidebar.about"],
      waits: ["settings.about.updater.check"],
      observe: "settings-about-updater",
    },
    {
      clicks: ["settings.about.updater.check"],
      observe: "settings-about-updater-after-check",
    },
  ];

  let firstObserve = null;
  for (const step of steps) {
    for (const target of step.clicks ?? []) await clickAgentTarget(sessionId, target);
    for (const routePart of step.routeIncludes ?? []) await waitForRouteIncludes(sessionId, routePart);
    for (const target of step.waits ?? []) await waitForAgentElement(sessionId, target);
    for (const prefix of step.waitPrefixes ?? []) await waitForAgentElementPrefix(sessionId, prefix);
    if (step.observe) {
      const observe = await observeAgentStep(sessionId, step.observe);
      firstObserve ??= observe;
    }
    for (const target of step.after ?? []) await clickAgentTarget(sessionId, target);
  }
  return firstObserve;
}

async function screenshot(sessionId, name) {
  const result = await request("GET", `/session/${sessionId}/screenshot`);
  const target = path.join(runDir, name);
  await writeFile(target, Buffer.from(result.value, "base64"));
  return target;
}

async function main() {
  await mkdir(runDir, { recursive: true });
  const defaultUrlReady = await isUrlReady(devUrl);
  let autoSelectedDevUrl = false;
  if (defaultUrlReady) {
    const hasLiliaGithub = await devUrlHasLiliaGithub(devUrl);
    if (explicitDevUrl && !hasLiliaGithub) {
      await writeJson("summary.json", {
        status: "blocked",
        runId,
        reason: `${devUrl} is already serving a different app. Choose another LILIA_GITHUB_AGENT_DEBUG_DEV_URL or stop that server before running Agent debug smoke.`,
        replay,
      });
      process.exitCode = 2;
      return;
    }
    if (!explicitDevUrl) {
      devUrl = await findAvailableDevUrl(parsePortFromUrl(defaultDevUrl) + 1);
      autoSelectedDevUrl = true;
    }
  }

  const preflight = {
    runId,
    runDir,
    appBinary,
    devUrl,
    autoSelectedDevUrl,
    tauriDriver: commandExists("tauri-driver", ["--help"]),
    edgeDriver: commandExists("msedgedriver") || commandExists("MicrosoftWebDriver"),
    cargo: commandExists("cargo"),
    localViteBin,
    localViteExists: existsSync(localViteBin),
    appBinaryExists: existsSync(appBinary),
    platform: process.platform,
    home: os.homedir(),
    appDataDir,
    webviewDataDir,
  };
  const needsDevServer = !(await isUrlReady(devUrl));
  const shouldBuildDebugApp = !explicitAppBinary;
  await writeJson("preflight.json", preflight);
  if (
    !preflight.tauriDriver ||
    !preflight.edgeDriver ||
    (needsDevServer && !preflight.localViteExists) ||
    (explicitAppBinary && !preflight.appBinaryExists) ||
    (shouldBuildDebugApp && !preflight.cargo)
  ) {
    await writeJson("summary.json", {
      status: "blocked",
      reason: "Missing tauri-driver, EdgeDriver, cargo, local Vite, or debug app binary.",
      preflight,
      nextStep: "Run cargo install tauri-driver, install a matching EdgeDriver, ensure cargo is on PATH, run yarn install, build a debug binary, or set LILIA_GITHUB_AGENT_DEBUG_APP.",
    });
    process.exitCode = 2;
    return;
  }

  if (shouldBuildDebugApp) {
    preflight.rebuildReason = autoSelectedDevUrl
      ? `${defaultDevUrl} is occupied by another app.`
      : `Preparing debug app for ${devUrl}.`;
    preflight.rebuildOutputPath = await writeJson("debug-app-build-started.json", {
      devUrl,
      appBinary,
      reason: preflight.rebuildReason,
    });
    const rebuildOutput = await buildDebugAppForDevUrl(devUrl);
    await writeFile(path.join(runDir, "debug-app-build.log"), rebuildOutput, "utf8");
    preflight.rebuiltAppBinary = true;
    preflight.appBinaryExists = existsSync(appBinary);
    await writeJson("preflight.json", preflight);
  }

  let devServer = null;
  const devServerOutput = [];
  let driver = null;
  const driverOutput = [];
  let sessionId = null;
  try {
    if (await isUrlReady(devUrl)) {
      if (!(await devUrlHasLiliaGithub(devUrl))) {
        await writeJson("summary.json", {
          status: "blocked",
          runId,
          preflight,
          reason: `${devUrl} is already serving a different app. Stop that server or rebuild the debug binary with a different devUrl before running Agent debug smoke.`,
          replay,
        });
        process.exitCode = 2;
        return;
      }
    } else {
      devServer = spawn(process.execPath, [localViteBin, "--host", "127.0.0.1"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ...agentDebugEnv,
          LILIA_GITHUB_DEV_PORT: String(parsePortFromUrl(devUrl)),
          LILIA_GITHUB_DEV_STRICT_PORT: "1",
        },
      });
      devServer.stdout.on("data", (chunk) => devServerOutput.push(chunk.toString("utf8")));
      devServer.stderr.on("data", (chunk) => devServerOutput.push(chunk.toString("utf8")));
      await waitForUrl(devUrl, 30_000, "Vite dev server", devServer, devServerOutput);
      if (!(await devUrlHasLiliaGithub(devUrl))) {
        throw new Error(`${devUrl} became ready but is not serving LiliaGithub`);
      }
    }

    driver = spawn("tauri-driver", ["--port", String(driverPort)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...agentDebugEnv,
      },
    });
    driver.stdout.on("data", (chunk) => driverOutput.push(chunk.toString("utf8")));
    driver.stderr.on("data", (chunk) => driverOutput.push(chunk.toString("utf8")));

    await waitForDriver();
    const session = await request("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          browserName: "wry",
          "tauri:options": {
            application: appBinary,
            args: [],
            env: {
              ...agentDebugEnv,
            },
          },
        },
      },
    });
    sessionId = session.value.sessionId;
    await waitForDebugApi(sessionId);
    await waitForDebugUi(sessionId);
    const beforeScreenshotPath = await screenshot(sessionId, "before.png");
    const observe = await runRegressionFlow(sessionId);

    await writeJson("observe.json", observe);
    await writeJson("missing-agent-ids.json", observe.missingAgentIds ?? []);

    const markResult = await execute(
      sessionId,
      "const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug; return api.mark('verify-agent-debug-smoke', { source: 'agent-debug:verify' });",
    );
    await writeJson("after-mark-observe.json", markResult);
    replay.push({ type: "mark", label: "verify-agent-debug-smoke" });

    const missingTargetError = await execute(
      sessionId,
      "const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug; return api.act({ type: 'click', target: 'missing.debug.target' }).then(() => null, err => String(err && err.message || err));",
    );
    if (!String(missingTargetError).includes("missing.debug.target")) {
      throw new Error("Missing target scenario did not return a useful diagnostic");
    }
    replay.push({ type: "click", target: "missing.debug.target", expectedError: true });
    const afterScreenshotPath = await screenshot(sessionId, "after.png");
    await writeJson("replay.json", replay);
    await writeJson("summary.json", {
      status: "passed",
      runId,
      preflight,
      beforeScreenshotPath,
      afterScreenshotPath,
      observePath: path.join(runDir, "observe.json"),
      missingAgentIdsPath: path.join(runDir, "missing-agent-ids.json"),
      observedSnapshots,
      replayPath: path.join(runDir, "replay.json"),
      missingAgentIdCount: observedSnapshots.reduce((count, item) => count + item.missingAgentIdCount, 0),
    });
  } catch (error) {
    let failureDiagnosticsPath = null;
    let failureScreenshotPath = null;
    if (sessionId) {
      failureScreenshotPath = await screenshot(sessionId, "failure.png").catch(() => null);
      const diagnostics = await execute(
        sessionId,
        `return {
          location: window.location.href,
          title: document.title,
          readyState: document.readyState,
          bodyText: document.body?.innerText?.slice(0, 2000) ?? "",
          hasAgentDebug: Boolean(window.__liliaGithubAgentDebug || window.__liliaAgentDebug),
          observe: (() => {
            try {
              const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
              return api?.observe?.() ?? null;
            } catch (error) {
              return { error: String(error?.message ?? error) };
            }
          })(),
        };`,
      ).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError?.message ?? diagnosticError) }));
      failureDiagnosticsPath = await writeJson("failure-diagnostics.json", diagnostics).catch(() => null);
    }
    await writeJson("summary.json", {
      status: "failed",
      runId,
      preflight,
      message: error?.message ?? String(error),
      driverOutput,
      devServerOutput,
      failureScreenshotPath,
      failureDiagnosticsPath,
      observedSnapshots,
      replay,
    });
    process.exitCode = 1;
  } finally {
    if (sessionId) await request("DELETE", `/session/${sessionId}`).catch(() => undefined);
    driver?.kill();
    stopProcessTree(devServer);
    await writeFile(path.join(runDir, "tauri-driver.log"), driverOutput.join(""), "utf8");
    await writeFile(path.join(runDir, "dev-server.log"), devServerOutput.join(""), "utf8");
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await main();
}
