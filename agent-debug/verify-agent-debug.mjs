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
const debugAppIdentifier = `com.liliagithub.desktop.agent-debug.${runId.toLowerCase()}`;
const defaultDevUrl = "http://127.0.0.1:1420";
const explicitDevUrl = Boolean(process.env.LILIA_GITHUB_AGENT_DEBUG_DEV_URL);
const explicitAppBinary = Boolean(process.env.LILIA_GITHUB_AGENT_DEBUG_APP);
let devUrl = process.env.LILIA_GITHUB_AGENT_DEBUG_DEV_URL ?? defaultDevUrl;
const appBinary = process.env.LILIA_GITHUB_AGENT_DEBUG_APP ?? defaultAppBinary();
const localViteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const replay = [];
const observedSnapshots = [];
const replayAssertions = [];

const agentDebugEnv = {
  LILIA_GITHUB_AGENT_DEBUG: "1",
  VITE_LILIA_AGENT_DEBUG: "1",
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

async function waitForLiliaGithubDevUrl(url, timeoutMs, child = null, output = []) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`Vite dev server exited before serving LiliaGithub: ${output.join("").trim() || child.exitCode}`);
    }
    if (await devUrlHasLiliaGithub(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} became ready but is not serving LiliaGithub`);
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

function launchCandidateAgentId(command, cwd = null) {
  return `repo.toolbar.launch.candidate.${encodeURIComponent(JSON.stringify([command, cwd ?? null]))}`;
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

export function findEnabledVisibleAgentId(elements, candidates) {
  const available = new Set(
    (elements ?? [])
      .filter((element) => element.visible !== false && element.disabled !== true)
      .map((element) => element.id || element.agentId)
      .filter(Boolean),
  );
  return candidates.find((candidate) => available.has(candidate)) ?? null;
}

function findControlCenterActionTarget(elements, bucket, action) {
  const prefix = `control-center.${bucket}.`;
  const suffix = `.${action}`;
  return (elements ?? [])
    .filter((element) => element.visible !== false && element.disabled !== true)
    .map((element) => element.id || element.agentId)
    .find((id) => id?.startsWith(prefix) && id.endsWith(suffix)) ?? null;
}

function findReviewLineCommentTarget(elements) {
  return (elements ?? [])
    .filter((element) => element.visible !== false && element.disabled !== true)
    .map((element) => element.id || element.agentId)
    .find((id) => /^repo\.pulls\.review\.file\..+\.line\.(left|right)\.\d+\.comment$/.test(id ?? "")) ?? null;
}

function findReviewThreadTarget(elements, excludedTargets = []) {
  const excluded = new Set(excludedTargets);
  return (elements ?? [])
    .filter((element) => element.visible !== false)
    .map((element) => element.id || element.agentId)
    .find((id) => /^repo\.pulls\.review\.thread\.[^.]+$/.test(id ?? "") && !excluded.has(id)) ?? null;
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
  config.identifier = debugAppIdentifier;

  return run(
    "cargo",
    [
      "build",
      "--manifest-path",
      path.join(repoRoot, "src-tauri", "Cargo.toml"),
      "--features",
      "agent-debug-webdriver",
    ],
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
  throw new Error("embedded Tauri WebDriver did not become ready within 15s");
}

async function execute(sessionId, script, args = []) {
  const result = await request("POST", `/session/${sessionId}/execute/sync`, { script, args });
  return result?.value;
}

const observeAgentDebugScript = `
const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
const snapshot = api?.observe?.();
if (!snapshot) return null;
const cssEscape = (value) => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/["\\\\]/g, "\\\\$&");
};
const rectFor = (rect) => ({
  x: rect?.x ?? 0,
  y: rect?.y ?? 0,
  width: rect?.width ?? 0,
  height: rect?.height ?? 0,
});
const readRole = (element) => {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "input") return "input";
  if (tag === "textarea") return "textbox";
  if (tag === "a") return "link";
  return null;
};
const readableText = (element) => (element.getAttribute("aria-label") || element.textContent || "").trim();
const isVisible = (element, rect) => {
  const style = window.getComputedStyle(element);
  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number.parseFloat(style.opacity || "1") > 0 &&
    Boolean(!rect || rect.width > 0 || rect.height > 0);
};
const diagnosticSelectorFor = (element) => {
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute("aria-label");
  return label ? tag + "[aria-label=\\"" + cssEscape(label) + "\\"]" : tag;
};
const elements = (snapshot.elements ?? [])
  .map((element) => ({
    ...element,
    id: element.id || element.agentId,
    visible: element.visible !== false,
  }))
  .filter((element) => element.id);
const missingAgentIds = Array.from(document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [tabindex]"))
  .filter((element) => !element.dataset.agentId)
  .map((element) => {
    const rect = element.getBoundingClientRect();
    if (!isVisible(element, rect)) return null;
    return {
      role: readRole(element),
      text: readableText(element),
      tagName: element.tagName.toLowerCase(),
      selector: diagnosticSelectorFor(element),
      rect: rectFor(rect),
      nearestAgentId: element.closest("[data-agent-id]")?.dataset.agentId ?? null,
    };
  })
  .filter(Boolean);
return {
  ...snapshot,
  activeElement: snapshot.activeElement?.id
    ? snapshot.activeElement
    : snapshot.activeElement?.agentId
      ? { ...snapshot.activeElement, id: snapshot.activeElement.agentId }
      : snapshot.activeElement,
  enabled: true,
  elements,
  missingAgentIds: snapshot.missingAgentIds ?? missingAgentIds,
};
`;

async function waitForDebugApi(sessionId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await execute(
      sessionId,
      "const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug; return Boolean(api?.observe && api?.act);",
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
         (element.id || element.agentId) === "app.shell" ||
         (element.id || element.agentId) === "setup.screen" ||
         (element.id || element.agentId) === "sidebar" ||
         (element.id || element.agentId) === "titlebar"
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

async function waitForAgentElement(sessionId, target, timeoutMs = 30_000, requireEnabled = false) {
  await waitForAgentDebugCondition(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     const observe = api?.observe?.();
     return Boolean(observe?.elements?.some((element) =>
       (element.id || element.agentId) === arguments[0] &&
       element.visible !== false &&
       (!arguments[1] || element.disabled !== true)
     ));`,
    [target, requireEnabled],
    `Agent debug target did not become ${requireEnabled ? "enabled" : "visible"}: ${target}`,
    timeoutMs,
  );
}

async function waitForAgentElementPrefix(sessionId, prefix, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     const observe = api?.observe?.();
     return Boolean(observe?.elements?.some((element) =>
       (element.id || element.agentId || "").startsWith(arguments[0]) && element.visible !== false
     ));`,
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

async function waitForExactRoute(sessionId, expectedRoute, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    "return window.location.pathname + window.location.search + window.location.hash === arguments[0];",
    [expectedRoute],
    `Agent debug route did not become exact route: ${expectedRoute}`,
    timeoutMs,
  );
}

async function waitForAgentTargetAbsent(sessionId, target, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     const observe = api?.observe?.();
     return !observe?.elements?.some((element) =>
       (element.id || element.agentId) === arguments[0] && element.visible !== false
     );`,
    [target],
    `Agent debug target did not disappear: ${target}`,
    timeoutMs,
  );
}

async function waitForAgentPressed(sessionId, target, pressed, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     return element?.getAttribute('aria-pressed') === String(arguments[1]);`,
    [target, pressed],
    `Agent debug target did not reach aria-pressed=${pressed}: ${target}`,
    timeoutMs,
  );
}

async function waitForControlCenterActionTarget(sessionId, bucket, action, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const elements = await execute(
      sessionId,
      `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
       return api?.observe?.()?.elements ?? [];`,
    ).catch(() => []);
    const target = findControlCenterActionTarget(elements, bucket, action);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No enabled control-center ${bucket} ${action} target became visible.`);
}

async function readAgentLinkRoute(sessionId, target) {
  const route = await execute(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     if (!(element instanceof HTMLAnchorElement)) return null;
     const url = new URL(element.href, window.location.href);
     return url.pathname + url.search + url.hash;`,
    [target],
  );
  if (!route) throw new Error(`Agent debug target is not a routed link: ${target}`);
  return route;
}

async function waitForAgentLinkTargetByRoute(sessionId, prefix, route, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await execute(
      sessionId,
      `const candidates = Array.from(document.querySelectorAll('[data-agent-id]'));
       const match = candidates.find((element) => {
         if (!(element instanceof HTMLAnchorElement) || !element.dataset.agentId?.startsWith(arguments[0])) return false;
         const url = new URL(element.href, window.location.href);
         return url.pathname + url.search + url.hash === arguments[1];
       });
       return match?.dataset.agentId ?? null;`,
      [prefix, route],
    ).catch(() => null);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No agent link with prefix ${prefix} routes to ${route}`);
}

function recordReplayAssertion(name, evidence) {
  const assertion = { name, status: "passed", evidence };
  replayAssertions.push(assertion);
  replay.push({ type: "assert", ...assertion });
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

async function typeAgentTarget(sessionId, target, value) {
  await waitForAgentElement(sessionId, target, 30_000, true);
  await execute(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     return api.act({ type: 'type', target: arguments[0], text: arguments[1], clear: true });`,
    [target, value],
  );
  replay.push({ type: "type", target, valueLength: value.length });
}

async function waitForAgentInputValue(sessionId, target, expected, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
       ? element.value === arguments[1]
       : false;`,
    [target, expected],
    `Agent debug input ${target} did not reach the expected value.`,
    timeoutMs,
  );
}

async function selectAgentTarget(sessionId, target, value) {
  await waitForAgentElement(sessionId, target, 30_000, true);
  const changed = await execute(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     if (!(element instanceof HTMLSelectElement)) return false;
     element.value = arguments[1];
     element.dispatchEvent(new Event('input', { bubbles: true }));
     element.dispatchEvent(new Event('change', { bubbles: true }));
     return element.value === arguments[1];`,
    [target, value],
  );
  if (!changed) throw new Error(`Agent debug select ${target} could not choose ${value}.`);
  replay.push({ type: "select", target, value });
}

async function waitForAgentSelectValue(sessionId, target, expected, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     return element instanceof HTMLSelectElement && element.value === arguments[1];`,
    [target, expected],
    `Agent debug select ${target} did not reach the expected value.`,
    timeoutMs,
  );
}

async function waitForAgentDisabled(sessionId, target, disabled = true, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     return element instanceof HTMLButtonElement && element.disabled === arguments[1];`,
    [target, disabled],
    `Agent debug target ${target} did not reach disabled=${disabled}.`,
    timeoutMs,
  );
}

async function clickReviewLineCommentTarget(sessionId) {
  const preferredTarget = "repo.pulls.review.file.src_2Fexample.ts.line.right.2.comment";
  const elements = await execute(
    sessionId,
    `return Array.from(document.querySelectorAll('[data-agent-id]'))
      .filter((element) => /^repo\\.pulls\\.review\\.file\\..+\\.line\\.(left|right)\\.\\d+\\.comment$/.test(element.dataset.agentId ?? ''))
      .map((element) => ({
        id: element.dataset.agentId,
        visible: true,
        disabled: element instanceof HTMLButtonElement ? element.disabled : false,
      }));`,
  );
  const preferred = elements.find((element) => element.id === preferredTarget && element.disabled !== true);
  const target = preferred?.id ?? findReviewLineCommentTarget(elements);
  if (!target) throw new Error("No stable PR review line-comment target is present in the debug mock diff.");
  await waitForAgentDebugCondition(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     return element instanceof HTMLButtonElement && !element.disabled;`,
    [target],
    `PR review line-comment target is not enabled: ${target}`,
  );
  await execute(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     element?.focus();
     const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     return api.act({ type: 'click', target: arguments[0] });`,
    [target],
  );
  replay.push({ type: "click", target });
  return target;
}

async function reviewThreadTargets(sessionId) {
  return execute(
    sessionId,
    `return Array.from(document.querySelectorAll('[data-agent-id]'))
      .map((element) => element.dataset.agentId)
      .filter((id) => /^repo\\.pulls\\.review\\.thread\\.[^.]+$/.test(id ?? ''));`,
  );
}

async function waitForNewReviewThreadTarget(sessionId, previousTargets, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await reviewThreadTargets(sessionId).catch(() => []);
    const next = findReviewThreadTarget(
      targets.map((target) => ({ id: target, visible: true, disabled: false })),
      previousTargets,
    );
    if (next) return next;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The submitted line comment did not create a visible review thread.");
}

async function reviewThreadCommentCount(sessionId, threadTarget) {
  return execute(
    sessionId,
    `const thread = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((element) => element.dataset.agentId === arguments[0]);
     return thread?.querySelectorAll('.review-thread__comments > li').length ?? -1;`,
    [threadTarget],
  );
}

async function waitForReviewThreadCommentCount(sessionId, threadTarget, expected, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const thread = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((element) => element.dataset.agentId === arguments[0]);
     return (thread?.querySelectorAll('.review-thread__comments > li').length ?? -1) === arguments[1];`,
    [threadTarget, expected],
    `Review thread ${threadTarget} did not reach ${expected} comments.`,
    timeoutMs,
  );
}

async function waitForAgentClass(sessionId, target, className, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `const element = Array.from(document.querySelectorAll('[data-agent-id]'))
       .find((candidate) => candidate.dataset.agentId === arguments[0]);
     return Boolean(element?.classList.contains(arguments[1]));`,
    [target, className],
    `Agent debug target ${target} did not gain class ${className}.`,
    timeoutMs,
  );
}

async function waitForConversationActionByBody(sessionId, body, action, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await execute(
      sessionId,
      `const entry = Array.from(document.querySelectorAll('.discussion-timeline__entry'))
         .find((candidate) => candidate.textContent?.includes(arguments[0]));
       return Array.from(entry?.querySelectorAll('[data-agent-id]') ?? [])
         .map((element) => element.dataset.agentId)
         .find((id) => id?.endsWith('.' + arguments[1])) ?? null;`,
      [body, action],
    ).catch(() => null);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No ${action} action became available for the newly written conversation item.`);
}

async function waitForConversationBody(sessionId, body, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `return Array.from(document.querySelectorAll('.discussion-timeline__entry'))
      .some((candidate) => candidate.textContent?.includes(arguments[0]));`,
    [body],
    "The locally updated conversation body did not become visible.",
    timeoutMs,
  );
}

async function waitForDiscussionActionByBody(sessionId, body, action, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await execute(
      sessionId,
      `const comment = Array.from(document.querySelectorAll('.discussion-comment'))
         .find((candidate) => candidate.textContent?.includes(arguments[0]));
       return Array.from(comment?.querySelectorAll('[data-agent-id]') ?? [])
         .map((element) => element.dataset.agentId)
         .find((id) => id?.endsWith('.' + arguments[1])) ?? null;`,
      [body, action],
    ).catch(() => null);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No Discussion ${action} action became available for the newly written comment.`);
}

async function waitForDiscussionReplyBody(sessionId, body, timeoutMs = 30_000) {
  await waitForAgentDebugCondition(
    sessionId,
    `return Array.from(document.querySelectorAll('.discussion-comment__reply'))
      .some((candidate) => candidate.textContent?.includes(arguments[0]));`,
    [body],
    "The newly written Discussion reply did not become visible.",
    timeoutMs,
  );
}

async function enabledVisibleAgentTarget(sessionId, candidates) {
  const elements = await execute(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     return api?.observe?.()?.elements ?? [];`,
  );
  return findEnabledVisibleAgentId(elements, candidates);
}

async function waitForVisibleAgentId(sessionId, selectSource, args, errorMessage, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await execute(
      sessionId,
      `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
       const observe = api?.observe?.();
       const ids = (observe?.elements ?? [])
         .filter((element) => element.visible !== false && element.disabled !== true)
         .map((element) => element.id || element.agentId)
         .filter(Boolean);
       const select = ${selectSource};
       return select(ids, ...arguments) || null;`,
      args,
    ).catch(() => null);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(errorMessage);
}

async function observeAgentStep(sessionId, label) {
  const observe = await execute(
    sessionId,
    observeAgentDebugScript,
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

async function openDiscoveryFromCurrentRoute(sessionId) {
  const target = await waitForAgentLinkTargetByRoute(sessionId, "sidebar.nav.", "/discovery");
  await clickAgentTarget(sessionId, target);
  await waitForExactRoute(sessionId, "/discovery");
  await waitForAgentElement(sessionId, "discovery.page");
  await waitForAgentElement(sessionId, "control-center.board");
}

async function runNotificationAndCommentFlow(sessionId) {
  const notificationsTarget = await waitForAgentLinkTargetByRoute(sessionId, "sidebar.nav.", "/notifications");
  await clickAgentTarget(sessionId, notificationsTarget);
  await waitForExactRoute(sessionId, "/notifications");
  await waitForAgentElement(sessionId, "notifications.page");

  const markRow = "notifications.row.agent-debug-mark-read";
  const markTarget = `${markRow}.mark-read`;
  const openRow = "notifications.row.agent-debug-open-issue";
  const openTarget = `${openRow}.open`;
  await waitForAgentElement(sessionId, markTarget, 30_000, true);
  await waitForAgentElement(sessionId, openTarget, 30_000, true);
  recordReplayAssertion("notifications-inbox-loaded", { route: "/notifications", rows: [markRow, openRow] });
  await observeAgentStep(sessionId, "notifications-inbox-loaded");

  await waitForAgentClass(sessionId, markRow, "is-unread");
  await clickAgentTarget(sessionId, markTarget);
  await waitForAgentTargetAbsent(sessionId, markRow);
  recordReplayAssertion("notifications-single-mark-read", {
    row: markRow,
    initiallyUnread: true,
    absentFromUnreadInbox: true,
  });

  const issueRoute = "/repos/github%3Asena-nana%2FLiliaGithub?projectTab=issues&issue=12";
  await clickAgentTarget(sessionId, openTarget);
  await waitForExactRoute(sessionId, issueRoute);
  await waitForAgentElement(sessionId, "repo.conversation.create-body", 30_000, true);
  recordReplayAssertion("notifications-recognized-object-exact-route", {
    target: openTarget,
    expectedRoute: issueRoute,
    actualRoute: issueRoute,
  });
  await observeAgentStep(sessionId, "notification-opened-issue");

  const createBody = `agent-debug-comment-${runId}`;
  await typeAgentTarget(sessionId, "repo.conversation.create-body", createBody);
  await waitForAgentElement(sessionId, "repo.conversation.create-submit", 30_000, true);
  await clickAgentTarget(sessionId, "repo.conversation.create-submit");
  await waitForAgentInputValue(sessionId, "repo.conversation.create-body", "");
  const editTarget = await waitForConversationActionByBody(sessionId, createBody, "edit");
  recordReplayAssertion("issue-comment-create-local-result", {
    composer: "repo.conversation.create-body",
    submit: "repo.conversation.create-submit",
    draftCleared: true,
    commentVisible: true,
    editTarget,
  });

  const editPrefix = editTarget.slice(0, -".edit".length);
  const editBodyTarget = `${editPrefix}.edit-body`;
  const editSubmitTarget = `${editPrefix}.edit-submit`;
  const updatedBody = `${createBody}-edited`;
  await clickAgentTarget(sessionId, editTarget);
  await typeAgentTarget(sessionId, editBodyTarget, updatedBody);
  await waitForAgentElement(sessionId, editSubmitTarget, 30_000, true);
  await clickAgentTarget(sessionId, editSubmitTarget);
  await waitForAgentTargetAbsent(sessionId, editBodyTarget);
  await waitForConversationBody(sessionId, updatedBody);
  await waitForExactRoute(sessionId, issueRoute);
  recordReplayAssertion("issue-comment-edit-local-result", {
    editTarget,
    editSubmitTarget,
    editorClosed: true,
    updatedBodyVisible: true,
    routePreserved: issueRoute,
  });
  await observeAgentStep(sessionId, "issue-comment-written-and-edited");

  await clickAgentTarget(sessionId, "repo.project.sidebar.discussions");
  await waitForAgentElement(sessionId, "repo.discussions.1.open", 30_000, true);
  await clickAgentTarget(sessionId, "repo.discussions.1.open");
  await waitForAgentElement(sessionId, "repo.discussions.comments.create-body", 30_000, true);
  const discussionBody = `agent-debug-discussion-${runId}`;
  await typeAgentTarget(sessionId, "repo.discussions.comments.create-body", discussionBody);
  await waitForAgentElement(sessionId, "repo.discussions.comments.create-submit", 30_000, true);
  await clickAgentTarget(sessionId, "repo.discussions.comments.create-submit");
  await waitForAgentInputValue(sessionId, "repo.discussions.comments.create-body", "");
  const replyTarget = await waitForDiscussionActionByBody(sessionId, discussionBody, "reply");
  recordReplayAssertion("discussion-comment-create-local-result", {
    draftCleared: true,
    commentVisible: true,
    replyTarget,
  });

  const discussionPrefix = replyTarget.slice(0, -".reply".length);
  const replyBodyTarget = `${discussionPrefix}.reply-body`;
  const replySubmitTarget = `${discussionPrefix}.reply-submit`;
  const repliesTarget = `${discussionPrefix}.replies`;
  const replyBody = `${discussionBody}-reply`;
  await clickAgentTarget(sessionId, replyTarget);
  await typeAgentTarget(sessionId, replyBodyTarget, replyBody);
  await waitForAgentElement(sessionId, replySubmitTarget, 30_000, true);
  await clickAgentTarget(sessionId, replySubmitTarget);
  await waitForAgentTargetAbsent(sessionId, replyBodyTarget);
  await waitForAgentElement(sessionId, repliesTarget, 30_000, true);
  await clickAgentTarget(sessionId, repliesTarget);
  await waitForDiscussionReplyBody(sessionId, replyBody);
  recordReplayAssertion("discussion-comment-reply-local-result", {
    replySubmitTarget,
    editorClosed: true,
    replyVisible: true,
  });
  await observeAgentStep(sessionId, "discussion-comment-written-and-replied");
}

async function runControlCenterFlow(sessionId) {
  await waitForAgentElement(sessionId, "control-center.attention");
  await waitForAgentElement(sessionId, "control-center.today");
  const pinTarget = await waitForControlCenterActionTarget(sessionId, "attention", "pin");
  const rowTarget = pinTarget.slice(0, -".pin".length);
  const snoozeTarget = `${rowTarget}.snooze`;
  const attentionOpenTarget = `${rowTarget}.open`;

  await clickAgentTarget(sessionId, pinTarget);
  await waitForAgentPressed(sessionId, pinTarget, true);
  recordReplayAssertion("control-center-attention-pin", { target: pinTarget, ariaPressed: true });

  await clickAgentTarget(sessionId, snoozeTarget);
  await waitForAgentTargetAbsent(sessionId, rowTarget);
  await waitForAgentElement(sessionId, "control-center.hidden.restore", 30_000, true);
  recordReplayAssertion("control-center-attention-snooze", {
    target: rowTarget,
    hidden: true,
    restoreTarget: "control-center.hidden.restore",
  });

  await clickAgentTarget(sessionId, "control-center.hidden.restore");
  await waitForAgentElement(sessionId, rowTarget);
  await waitForAgentPressed(sessionId, pinTarget, true);
  recordReplayAssertion("control-center-attention-restore", {
    target: rowTarget,
    visible: true,
    pinnedStatePreserved: true,
  });

  const attentionRoute = await readAgentLinkRoute(sessionId, attentionOpenTarget);
  await clickAgentTarget(sessionId, attentionOpenTarget);
  if (new URL(attentionRoute, "http://agent-debug.local").searchParams.get("resolveConflicts") === "1") {
    const durableRoute = new URL(attentionRoute, "http://agent-debug.local");
    durableRoute.searchParams.delete("resolveConflicts");
    await waitForExactRoute(sessionId, `${durableRoute.pathname}${durableRoute.search}${durableRoute.hash}`);
    await waitForAgentElement(sessionId, "repo.conflicts.dialog");
    recordReplayAssertion("control-center-attention-open", {
      target: attentionOpenTarget,
      deepLinkRoute: attentionRoute,
      conflictDialogOpen: true,
    });
  } else {
    await waitForExactRoute(sessionId, attentionRoute);
    recordReplayAssertion("control-center-attention-open", { target: attentionOpenTarget, route: attentionRoute });
  }
  await observeAgentStep(sessionId, "control-center-attention-open");
  await openDiscoveryFromCurrentRoute(sessionId);

  const todayOpenTarget = await waitForControlCenterActionTarget(sessionId, "today", "open");
  const todayRoute = await readAgentLinkRoute(sessionId, todayOpenTarget);
  await clickAgentTarget(sessionId, todayOpenTarget);
  await waitForExactRoute(sessionId, todayRoute);
  recordReplayAssertion("control-center-today-open", { target: todayOpenTarget, route: todayRoute });
  await observeAgentStep(sessionId, "control-center-today-open");
  await openDiscoveryFromCurrentRoute(sessionId);

  const continueOpenTarget = await waitForAgentLinkTargetByRoute(
    sessionId,
    "control-center.continue.",
    todayRoute,
  );
  await clickAgentTarget(sessionId, continueOpenTarget);
  await waitForExactRoute(sessionId, todayRoute);
  recordReplayAssertion("control-center-continue-exact-route", {
    target: continueOpenTarget,
    expectedRoute: todayRoute,
    actualRoute: todayRoute,
  });
  await observeAgentStep(sessionId, "control-center-continue-restored");
  await openDiscoveryFromCurrentRoute(sessionId);

  const handoffTarget = await waitForControlCenterActionTarget(sessionId, "attention", "handoff");
  const handoffPrefix = handoffTarget.slice(0, -".handoff".length);
  const resultTarget = `${handoffPrefix}.handoff-result`;
  await clickAgentTarget(sessionId, handoffTarget);
  await waitForAgentElement(sessionId, resultTarget, 30_000, true);
  recordReplayAssertion("control-center-workflow-handoff-accepted", {
    target: handoffTarget,
    resultTarget,
  });
  await clickAgentTarget(sessionId, resultTarget);
  await waitForAgentElement(sessionId, `${resultTarget}.status`);
  recordReplayAssertion("control-center-workflow-result-open", {
    target: resultTarget,
    statusTarget: `${resultTarget}.status`,
  });
  await observeAgentStep(sessionId, "control-center-workflow-result-opened");
}

async function runPullRequestReviewFlow(sessionId) {
  const pullTarget = "repo.pulls.7.open";
  const listRoute = await execute(
    sessionId,
    "return window.location.pathname + window.location.search + window.location.hash;",
  );
  const expectedUrl = new URL(listRoute, "http://agent-debug.local");
  expectedUrl.searchParams.set("pr", "7");
  const reviewRoute = `${expectedUrl.pathname}${expectedUrl.search}${expectedUrl.hash}`;

  await waitForAgentElement(sessionId, pullTarget, 30_000, true);
  await clickAgentTarget(sessionId, pullTarget);
  await waitForExactRoute(sessionId, reviewRoute);
  await waitForAgentElement(sessionId, "repo.pulls.review.workspace");
  await waitForAgentElement(sessionId, "repo.pulls.review.summary");
  recordReplayAssertion("pull-review-workspace-exact-route", {
    pullTarget,
    expectedRoute: reviewRoute,
    workspaceTarget: "repo.pulls.review.workspace",
  });

  await clickAgentTarget(sessionId, "repo.pulls.review.diff.split");
  await waitForAgentPressed(sessionId, "repo.pulls.review.diff.split", true);
  recordReplayAssertion("pull-review-split-diff", {
    target: "repo.pulls.review.diff.split",
    ariaPressed: true,
  });

  const previousThreads = await reviewThreadTargets(sessionId);
  const lineCommentTarget = await clickReviewLineCommentTarget(sessionId);
  const fileTarget = lineCommentTarget.slice(0, lineCommentTarget.indexOf(".line."));
  const lineBodyTarget = `${fileTarget}.comment.body`;
  const lineSubmitTarget = `${fileTarget}.comment.submit`;
  const lineBody = `agent-debug-pr-line-${runId}`;
  await typeAgentTarget(sessionId, lineBodyTarget, lineBody);
  await waitForAgentElement(sessionId, lineSubmitTarget, 30_000, true);
  await clickAgentTarget(sessionId, lineSubmitTarget);
  await waitForAgentTargetAbsent(sessionId, lineBodyTarget);
  const newThreadTarget = await waitForNewReviewThreadTarget(sessionId, previousThreads);
  recordReplayAssertion("pull-review-line-comment-local-result", {
    lineCommentTarget,
    lineSubmitTarget,
    draftCleared: true,
    newThreadTarget,
  });

  const replyBodyTarget = `${newThreadTarget}.reply.body`;
  const replySubmitTarget = `${newThreadTarget}.reply.submit`;
  const commentsBeforeReply = await reviewThreadCommentCount(sessionId, newThreadTarget);
  if (commentsBeforeReply < 1) throw new Error("The newly created review thread has no visible line comment.");
  const replyBody = `agent-debug-pr-reply-${runId}`;
  await typeAgentTarget(sessionId, replyBodyTarget, replyBody);
  await waitForAgentElement(sessionId, replySubmitTarget, 30_000, true);
  await clickAgentTarget(sessionId, replySubmitTarget);
  await waitForAgentInputValue(sessionId, replyBodyTarget, "");
  await waitForReviewThreadCommentCount(sessionId, newThreadTarget, commentsBeforeReply + 1);
  recordReplayAssertion("pull-review-thread-reply-local-result", {
    threadTarget: newThreadTarget,
    replySubmitTarget,
    draftCleared: true,
    commentCountBefore: commentsBeforeReply,
    commentCountAfter: commentsBeforeReply + 1,
  });

  await selectAgentTarget(sessionId, "repo.pulls.review.submit.event", "approve");
  await waitForAgentSelectValue(sessionId, "repo.pulls.review.submit.event", "approve");
  await waitForAgentElement(sessionId, "repo.pulls.review.submit.confirm", 30_000, true);
  await clickAgentTarget(sessionId, "repo.pulls.review.submit.confirm");
  await waitForAgentElement(sessionId, "repo.pulls.review.submit.notice");
  await waitForAgentDebugCondition(
    sessionId,
    `const summary = document.querySelector('[data-agent-id="repo.pulls.review.summary"]');
     return summary?.querySelector('strong')?.textContent?.trim().toLocaleUpperCase() === 'APPROVED';`,
    [],
    "PR review summary did not update to APPROVED after submission.",
  );
  recordReplayAssertion("pull-review-approve-summary", {
    eventTarget: "repo.pulls.review.submit.event",
    submitTarget: "repo.pulls.review.submit.confirm",
    noticeTarget: "repo.pulls.review.submit.notice",
    reviewDecision: "APPROVED",
  });

  await waitForAgentDisabled(sessionId, "repo.pulls.review.merge", true);
  recordReplayAssertion("pull-review-merge-gate-fail-closed", {
    gateTarget: "repo.pulls.review.merge-gate",
    mergeTarget: "repo.pulls.review.merge",
    disabled: true,
  });

  await execute(sessionId, "window.history.back(); return true;");
  replay.push({ type: "navigate-back", from: reviewRoute, to: listRoute });
  await waitForExactRoute(sessionId, listRoute);
  await waitForAgentElement(sessionId, pullTarget);
}

async function runRepoLaunchFlow(sessionId) {
  const candidateTarget = launchCandidateAgentId("yarn dev", null);

  await waitForAgentElement(sessionId, "repo.toolbar.launch.input", 30_000, true);
  await waitForAgentElement(sessionId, "repo.toolbar.launch.toggle", 30_000, true);
  await execute(
    sessionId,
    `const api = window.__liliaGithubAgentDebug || window.__liliaAgentDebug;
     return api.act({ type: 'type', target: 'repo.toolbar.launch.input', text: 'dev', clear: true });`,
  );
  replay.push({ type: "type", target: "repo.toolbar.launch.input", text: "dev" });
  await waitForAgentElement(sessionId, candidateTarget);
  await observeAgentStep(sessionId, "repo-launch-candidates");
  await clickAgentTarget(sessionId, candidateTarget);

  await waitForAgentElement(sessionId, "repo.toolbar.launch.toggle", 30_000, true);
  await clickAgentTarget(sessionId, "repo.toolbar.tab.run");
  await waitForRouteIncludes(sessionId, "/run");
  await waitForAgentElement(sessionId, "repo.launch.terminal");
  await observeAgentStep(sessionId, "repo-launch-terminal-idle");

  await clickAgentTarget(sessionId, "repo.toolbar.launch.toggle");
  await waitForAgentDebugCondition(
    sessionId,
    `const terminal = document.querySelector('[data-agent-id="repo.launch.terminal"]');
     return Boolean(terminal?.querySelector('.launch-log--system') && terminal?.querySelector('.launch-log--stdout'));`,
    [],
    "Launch terminal did not render system and stdout log lines",
  );
  await observeAgentStep(sessionId, "repo-launch-terminal-running");

  await waitForAgentElement(sessionId, "repo.toolbar.launch.toggle", 30_000, true);
  await clickAgentTarget(sessionId, "repo.toolbar.launch.toggle");
  await clickAgentTarget(sessionId, "repo.toolbar.tab.repo");
  await waitForRouteIncludes(sessionId, "/repos/LiliaGithub-linked-worktree");
}

async function refreshCurrentRepoPage(sessionId, routePart, pageTarget, observeLabel) {
  await waitForAgentElement(sessionId, "repo.toolbar.refresh-page", 30_000, true);
  await clickAgentTarget(sessionId, "repo.toolbar.refresh-page");
  await waitForAgentElement(sessionId, "repo.toolbar.refresh-page", 30_000, true);
  await waitForRouteIncludes(sessionId, routePart);
  await waitForAgentElement(sessionId, pageTarget);
  await observeAgentStep(sessionId, observeLabel);
}

async function runProfileInteractionFlow(sessionId) {
  const editTarget = await enabledVisibleAgentTarget(sessionId, ["profile.edit"]);
  if (editTarget) {
    await clickAgentTarget(sessionId, editTarget);
    await waitForAgentElement(sessionId, "profile.cancel", 30_000, true);
    await observeAgentStep(sessionId, "profile-edit");
    await clickAgentTarget(sessionId, "profile.cancel");
    await waitForAgentElement(sessionId, "profile.edit", 30_000, true);
    await observeAgentStep(sessionId, "profile-edit-cancelled");
  } else {
    replay.push({
      type: "skip",
      scenario: "profile-edit-cancel",
      reason: "profile.edit is not enabled for the fallback account",
    });
  }

  const profileScreenshotPath = await screenshot(sessionId, "profile.png");
  replay.push({ type: "screenshot", target: "profile.page", path: profileScreenshotPath });
  return profileScreenshotPath;
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
      waits: ["repo.project.sidebar.issues"],
      observe: "repo-readme-about",
    },
    {
      clicks: ["repo.project.sidebar.issues"],
      waits: ["repo.toolbar.refresh-page", "repo.issues.create"],
      observe: "issues-panel",
      refreshCurrentPage: {
        routePart: "projectTab=issues",
        pageTarget: "repo.issues.create",
        observe: "issues-panel-refreshed",
      },
    },
    {
      clicks: ["repo.issues.create"],
      waits: ["repo.issues.form.title"],
      observe: "issue-create-form",
      after: ["repo.issues.form.cancel"],
    },
    {
      clicks: ["repo.project.sidebar.pulls"],
      waits: ["repo.pulls.create"],
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
      waits: ["repo.toolbar.refresh-page"],
      observe: "actions-panel",
    },
    {
      clicks: ["repo.project.sidebar.release"],
      waits: ["repo.toolbar.refresh-page", "repo.release.filters.type"],
      observe: "release-panel",
    },
    {
      clicks: [
        "repo.release.filters.tag.v1.0.0-beta",
        "repo.release.create",
      ],
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
      clicks: ["sidebar.footer.settings", "settings.tab.appearance"],
      waits: ["settings.appearance.theme.dark", "settings.appearance.corner-radius"],
      observe: "settings-appearance",
    },
    {
      clicks: ["settings.tab.account"],
      waits: ["settings.account.github.bind"],
      observe: "settings-account",
    },
    {
      clicks: ["settings.tab.repositories"],
      waits: ["settings.repositories.page", "settings.repositories.contribution-identities"],
      observe: "settings-repositories",
    },
    {
      clicks: ["settings.tab.about"],
      waits: ["settings.about.page"],
      observe: "settings-about",
    },
  ];

  let firstObserve = null;
  let profileScreenshotPath = null;
  for (const step of steps) {
    for (const target of step.clicks ?? []) await clickAgentTarget(sessionId, target);
    for (const routePart of step.routeIncludes ?? []) await waitForRouteIncludes(sessionId, routePart);
    for (const target of step.waits ?? []) await waitForAgentElement(sessionId, target);
    for (const prefix of step.waitPrefixes ?? []) await waitForAgentElementPrefix(sessionId, prefix);
    if (step.observe) {
      const observe = await observeAgentStep(sessionId, step.observe);
      firstObserve ??= observe;
      if (step.observe === "home-overview") {
        await openDiscoveryFromCurrentRoute(sessionId);
        await observeAgentStep(sessionId, "discovery-control-center");
        await runControlCenterFlow(sessionId);
        await runNotificationAndCommentFlow(sessionId);
        const overviewTarget = await waitForAgentLinkTargetByRoute(sessionId, "sidebar.nav.", "/");
        await clickAgentTarget(sessionId, overviewTarget);
        await waitForExactRoute(sessionId, "/");
        await waitForAgentElement(sessionId, "home.page");
        await waitForAgentElement(sessionId, "home.overview.search");
      }
      if (step.observe === "pulls-panel") await runPullRequestReviewFlow(sessionId);
    }
    if (step.refreshCurrentPage) {
      await refreshCurrentRepoPage(
        sessionId,
        step.refreshCurrentPage.routePart,
        step.refreshCurrentPage.pageTarget,
        step.refreshCurrentPage.observe,
      );
    }
    if (step.observe === "linked-worktree-repo") await runRepoLaunchFlow(sessionId);
    if (step.observe === "profile-overview") profileScreenshotPath = await runProfileInteractionFlow(sessionId);
    for (const target of step.after ?? []) await clickAgentTarget(sessionId, target);
  }
  return { firstObserve, profileScreenshotPath };
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
    debugAppIdentifier,
    devUrl,
    autoSelectedDevUrl,
    webdriverProvider: "embedded",
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
  const readinessBlockers = [
    needsDevServer && !preflight.localViteExists ? "local Vite is missing; run yarn install" : null,
    explicitAppBinary && !preflight.appBinaryExists
      ? `configured debug app binary does not exist: ${appBinary}`
      : null,
    shouldBuildDebugApp && !preflight.cargo ? "cargo is not available on PATH" : null,
  ].filter(Boolean);
  preflight.replayReady = true;
  await writeJson("preflight.json", preflight);
  if (readinessBlockers.length) {
    await writeJson("summary.json", {
      status: "blocked",
      reason: "Agent debug readiness prerequisites are missing.",
      preflight,
      blockers: readinessBlockers,
      nextStep: "Run yarn install, ensure cargo is on PATH, build a debug binary, or set LILIA_GITHUB_AGENT_DEBUG_APP.",
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
      try {
        await waitForLiliaGithubDevUrl(devUrl, 5_000);
      } catch {
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
      await waitForLiliaGithubDevUrl(devUrl, 30_000, devServer, devServerOutput);
    }

    driver = spawn(appBinary, [], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...agentDebugEnv,
        TAURI_WEBDRIVER_PORT: String(driverPort),
      },
    });
    driver.stdout.on("data", (chunk) => driverOutput.push(chunk.toString("utf8")));
    driver.stderr.on("data", (chunk) => driverOutput.push(chunk.toString("utf8")));

    await waitForDriver();
    const session = await request("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          browserName: "tauri",
        },
      },
    });
    sessionId = session.value.sessionId;
    await waitForDebugApi(sessionId);
    await waitForDebugUi(sessionId);
    const beforeScreenshotPath = await screenshot(sessionId, "before.png");
    const { firstObserve: observe, profileScreenshotPath } = await runRegressionFlow(sessionId);

    await writeJson("observe.json", observe);
    await writeJson("missing-agent-ids.json", observe.missingAgentIds ?? []);

    const markResult = await execute(
      sessionId,
      `(window.__liliaGithubAgentDebug || window.__liliaAgentDebug).mark('verify-agent-debug-smoke', { source: 'agent-debug:verify' });
       ${observeAgentDebugScript}`,
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
      profileScreenshotPath,
      observePath: path.join(runDir, "observe.json"),
      missingAgentIdsPath: path.join(runDir, "missing-agent-ids.json"),
      observedSnapshots,
      desktopReplay: {
        status: "passed",
        assertions: replayAssertions,
      },
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
      replayAssertions,
      replay,
    });
    process.exitCode = 1;
  } finally {
    if (sessionId) await request("DELETE", `/session/${sessionId}`).catch(() => undefined);
    stopProcessTree(driver);
    stopProcessTree(devServer);
    await writeFile(path.join(runDir, "embedded-webdriver.log"), driverOutput.join(""), "utf8");
    await writeFile(path.join(runDir, "dev-server.log"), devServerOutput.join(""), "utf8");
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await main();
}
