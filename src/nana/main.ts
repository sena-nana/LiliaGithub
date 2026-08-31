/**
 * Nana IIFE entry — registers Home / Settings / Profile / Repo runners.
 * Built as single IIFE (inlineDynamicImports) for VueHost::initialize_with_web_api.
 */
import {
  createApp as createNanaRendererApp,
  installEventBridge,
  hostCall,
  nodeId,
  wrapNode,
} from "@nanaui/nanavue-runtime";
import { createLiliaGithubNanaApp } from "./createLiliaGithubNanaApp";
import { createMemoryHistory, type Router } from "vue-router";
import type { Component } from "vue";
import { useTheme } from "@lilia/ui/composables";
import type { GitHubRepoPage } from "../services/workspace";

function createNanaApp() {
  return {
    createApp: (root: Component) => createNanaRendererApp(root),
  };
}

function mountRootHandle() {
  return wrapNode(hostCall("mountRoot", []), "element", "body");
}

// CSS: tokens + page styles injected by build banner / Rust host.
import "@lilia/ui/styles.css";
import "@lilia/ui/styles/page.css";
import "../styles.css";
import "../styles/page.css";

interface NanaRunOptions {
  startReady?: boolean;
  completeSetup?: boolean;
  settings?: boolean;
  route?: string;
  tab?: string;
  repoId?: string;
}

interface NanaRunResult {
  ok: boolean;
  app: string;
  route?: string;
  tab?: string | string[];
  ready?: boolean;
  boxes?: number;
  texts?: unknown;
  gpuSlots?: unknown;
  stylesheets?: number;
  mountRoot?: unknown;
  version?: string;
  error?: string | null;
  pending?: boolean;
}

type NanaMountedApp = ReturnType<typeof createLiliaGithubNanaApp>;
type GithubListTarget = {
  listGitHubActionNotifications?: (...args: unknown[]) => Promise<unknown>;
  listGitHubAccountIssues?: (...args: unknown[]) => Promise<unknown>;
  listGitHubHomeAttention?: (...args: unknown[]) => Promise<unknown>;
  listGitHubRepos?: (...args: unknown[]) => Promise<GitHubRepoPage>;
  preloadGitHubRepos?: (...args: unknown[]) => Promise<GitHubRepoPage>;
};

let mounted: NanaMountedApp | null = null;

function injectCssBanner() {
  try {
    // Tokens first, PAGE last — PAGE owns shell grid / SecondaryPanel height chain.
    const css =
      (globalThis.__NANA_LILIA_TOKENS_CSS || "") +
      "\n" +
      (globalThis.__NANA_LILIA_PAGE_CSS || "");
    if (css.trim()) hostCall("injectStylesheet", [css]);
  } catch (_err) {}
}

async function settle(appRouter: Router | null | undefined, frames = 8) {
  // Drain router navigation + workspace initialize microtasks.
  for (let i = 0; i < frames; i++) {
    await Promise.resolve();
    try {
      hostCall("resolveLayout", []);
    } catch (_err) {}
  }
  if (appRouter) {
    await appRouter.isReady().catch(() => undefined);
  }
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
  try {
    hostCall("resolveLayout", []);
  } catch (_err) {}
}

async function runNanaApp(options: NanaRunOptions = {}): Promise<NanaRunResult> {
  injectCssBanner();
  installEventBridge();

  if (mounted) {
    try {
      mounted.app.unmount();
    } catch (_err) {}
    mounted = null;
  }
  try {
    hostCall("clearMount", []);
  } catch (_err) {}

  const { createApp } = createNanaApp();
  const history = createMemoryHistory();
  // --complete-setup must start ready so SecondaryPanel + Home share one tree
  // (incremental createWorkspace alone leaves binding/isReady races).
  const startReady = options.startReady === true || options.completeSetup === true;
  const initialPath = options.route || (options.settings ? "/settings?tab=appearance" : "/");

  const created = createLiliaGithubNanaApp({
    createApp,
    history,
    startReady,
  });

  // When startReady, seed bindingStatus so isAuthorized/isReady match AppShell.
  if (startReady && typeof created.workspace.getGitHubBindingStatus === "function") {
    try {
      const status = await created.workspace.getGitHubBindingStatus();
      created.workspace.stateFeature?.applyBindingStatus?.(status);
    } catch (_err) {}
  }

  // Harden GitHub list helpers — empty mock payloads must stay arrays/sections.
  const emptyAttention = () => ({
    pendingPullRequests: {
      items: [],
      failures: [],
      truncated: false,
      requestedRepositoryCount: 0,
      successfulRepositoryCount: 0,
    },
    workflowRuns: {
      items: [],
      failures: [],
      truncated: false,
      requestedRepositoryCount: 0,
      successfulRepositoryCount: 0,
    },
  });
  const hardenArrayFn = (
    obj: GithubListTarget | null | undefined,
    key: "listGitHubActionNotifications" | "listGitHubAccountIssues",
  ) => {
    if (!obj || typeof obj[key] !== "function") return;
    obj[key] = async () => [];
  };
  const hardenAttentionFn = (
    obj: GithubListTarget | null | undefined,
    key: "listGitHubHomeAttention",
  ) => {
    if (!obj || typeof obj[key] !== "function") return;
    obj[key] = async () => emptyAttention();
  };
  const mockRepoPage = (): GitHubRepoPage => ({
    items: [
      {
        id: 101,
        name: "NanaUI",
        fullName: "nana-demo/NanaUI",
        ownerLogin: "nana-demo",
        private: false,
        archived: false,
        disabled: false,
        description: null,
        defaultBranch: "main",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cloneUrl: "https://github.com/nana-demo/NanaUI.git",
        htmlUrl: "https://github.com/nana-demo/NanaUI",
        language: "Rust",
        owner: { login: "nana-demo", kind: "user", avatarUrl: null },
        permissions: { admin: true, push: true, pull: true },
      },
      {
        id: 102,
        name: "LiliaGithub",
        fullName: "nana-demo/LiliaGithub",
        ownerLogin: "nana-demo",
        private: false,
        archived: false,
        disabled: false,
        description: null,
        defaultBranch: "main",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cloneUrl: "https://github.com/nana-demo/LiliaGithub.git",
        htmlUrl: "https://github.com/nana-demo/LiliaGithub",
        language: "TypeScript",
        owner: { login: "nana-demo", kind: "user", avatarUrl: null },
        permissions: { admin: true, push: true, pull: true },
      },
    ],
    nextPage: null,
    scope: { kind: "all" },
  });
  for (const target of [
    created.workspace,
    created.workspace.github,
    created.workspace.github && created.workspace.github.client,
  ] as GithubListTarget[]) {
    hardenArrayFn(target, "listGitHubActionNotifications");
    hardenArrayFn(target, "listGitHubAccountIssues");
    hardenAttentionFn(target, "listGitHubHomeAttention");
    if (!target) continue;
    if (typeof target.listGitHubRepos === "function") {
      target.listGitHubRepos = async () => mockRepoPage();
    }
    if (typeof target.preloadGitHubRepos === "function") {
      target.preloadGitHubRepos = async () => mockRepoPage();
    }
  }

  const root = mountRootHandle();
  created.app.mount(root);

  // Navigate after mount so RouterView resolves.
  await created.router.replace(initialPath);
  await created.workspace.initialize();
  await settle(created.router);

  // Home.vue gates the real overview on bootstrapStatus === 'ready'.
  // isReady (root+binding) can be true while bootstrap is still loading.
  for (let i = 0; i < 40; i++) {
    const status = created.workspace.state?.bootstrapStatus;
    if (status === "ready" || status === "error") break;
    await Promise.resolve();
    try {
      hostCall("resolveLayout", []);
    } catch (_err) {}
  }
  const writableState = created.workspace.stateFeature?.state;
  if (
    startReady &&
    writableState &&
    writableState.bootstrapStatus !== "ready" &&
    writableState.bootstrapStatus !== "error"
  ) {
    writableState.bootstrapStatus = "ready";
    writableState.loading = false;
  }
  await settle(created.router, 12);

  if (options.completeSetup && !created.workspace.isReady.value) {
    try {
      await created.workspace.createWorkspace("demo-workspace", "/tmp/demo-workspace");
      if (typeof created.workspace.getGitHubBindingStatus === "function") {
        const status = await created.workspace.getGitHubBindingStatus();
        created.workspace.stateFeature?.applyBindingStatus?.(status);
      }
      await settle(created.router);
    } catch (err) {
      globalThis.__nanaLiliaError = err instanceof Error ? err.message : String(err);
    }
  }

  const snap = hostCall("layoutSnapshot", []) as NanaLayoutSnapshot | null | undefined;
  const result: NanaRunResult = {
    ok: !globalThis.__nanaLiliaError,
    app: "lilia-github-nana-real",
    route: created.router.currentRoute.value.path,
    tab: String(created.router.currentRoute.value.query.tab || "appearance"),
    ready: !!created.workspace.isReady.value,
    boxes: (snap && snap.boxes && snap.boxes.length) || 0,
    texts: (snap && snap.texts) || [],
    gpuSlots: (snap && snap.gpuSlots) || [],
    stylesheets: (snap && snap.stylesheets) || 0,
    mountRoot: nodeId(root),
    version: "nana-real-home-v1",
    error: globalThis.__nanaLiliaError || null,
  };
  mounted = created;
  globalThis.__nanaLiliaLast = result;
  return result;
}

async function completeSetupFromHost() {
  // Remount with startReady so Home + SecondaryPanel share one consistent ready tree.
  // Incremental createWorkspace alone leaves bindingStatus unset → isReady false → setup UI.
  return runHome({ startReady: true });
}

function runHome(options: NanaRunOptions = {}) {
  return runNanaApp({ ...options, route: options.route || "/" });
}

function runSettings(options: NanaRunOptions = {}) {
  const tab = options.tab || "appearance";
  return runNanaApp({
    ...options,
    startReady: true,
    settings: true,
    route: `/settings?tab=${tab}`,
  });
}

function runSettingsAppearance(options: NanaRunOptions = {}) {
  return runSettings({ ...options, tab: "appearance" });
}

function runSettingsAccount(options: NanaRunOptions = {}) {
  return runSettings({ ...options, tab: "account" });
}

function runSettingsWorkspace(options: NanaRunOptions = {}) {
  return runSettings({ ...options, tab: "repositories" });
}

function runSettingsAbout(options: NanaRunOptions = {}) {
  return runSettings({ ...options, tab: "about" });
}

function runProfile(options: NanaRunOptions = {}) {
  return runNanaApp({
    ...options,
    startReady: true,
    route: "/profile",
  });
}

function runRepo(options: NanaRunOptions = {}) {
  const repoId = (options && options.repoId) || "repo-1";
  return runNanaApp({
    ...options,
    startReady: true,
    route: `/repos/${repoId}`,
  });
}

globalThis.__nanaLilia = {
  run: runNanaApp,
  runHome,
  runSettings,
  runSettingsAppearance,
  runSettingsAccount,
  runSettingsWorkspace,
  runSettingsAbout,
  runProfile,
  runRepo,
  version: "phase4-p1e-repo-readme-files",
};

// Host invokes these synchronously; async work settles via microtasks + pump_frame.
// `__nanaLiliaLast` is set when the Promise resolves; host polls until ready.
function kick(
  runner: (options?: NanaRunOptions) => Promise<NanaRunResult>,
  options?: NanaRunOptions,
) {
  globalThis.__nanaLiliaReady = false;
  globalThis.__nanaLiliaError = null;
  const p = runner(options)
    .then((r: NanaRunResult) => {
      globalThis.__nanaLiliaLast = r;
      globalThis.__nanaLiliaReady = true;
      return r;
    })
    .catch((err: unknown) => {
      globalThis.__nanaLiliaError = err instanceof Error ? err.message : String(err);
      globalThis.__nanaLiliaReady = true;
      globalThis.__nanaLiliaLast = { ok: false, error: globalThis.__nanaLiliaError };
      return globalThis.__nanaLiliaLast as NanaRunResult;
    });
  globalThis.__nanaLiliaPending = p;
  return { ok: true, pending: true, app: "lilia-github-nana-real" };
}

function asRunOptions(opts?: unknown): NanaRunOptions {
  return opts && typeof opts === "object" ? (opts as NanaRunOptions) : {};
}

globalThis.__nanaLiliaRunHome = function __nanaLiliaRunHome(opts?: unknown) {
  const options = asRunOptions(opts);
  return kick(runHome, { completeSetup: !!options.completeSetup });
};

globalThis.__nanaLiliaRunSettings = function __nanaLiliaRunSettings(opts?: unknown) {
  const tab = asRunOptions(opts).tab || "appearance";
  return kick(runSettings, { tab });
};

globalThis.__nanaLiliaRunSettingsAccount = function __nanaLiliaRunSettingsAccount(opts?: unknown) {
  return kick(runSettingsAccount, asRunOptions(opts));
};

globalThis.__nanaLiliaRunSettingsWorkspace = function __nanaLiliaRunSettingsWorkspace(
  opts?: unknown,
) {
  return kick(runSettingsWorkspace, asRunOptions(opts));
};

globalThis.__nanaLiliaRunSettingsAbout = function __nanaLiliaRunSettingsAbout(opts?: unknown) {
  return kick(runSettingsAbout, asRunOptions(opts));
};

globalThis.__nanaLiliaRunProfile = function __nanaLiliaRunProfile() {
  return kick(runProfile, {});
};

globalThis.__nanaLiliaRunRepo = function __nanaLiliaRunRepo(opts?: unknown) {
  const repoId = asRunOptions(opts).repoId ? String(asRunOptions(opts).repoId) : "repo-1";
  return kick(runRepo, { repoId });
};

globalThis.__nanaLiliaIsReady = function __nanaLiliaIsReady() {
  return !!globalThis.__nanaLiliaReady;
};

globalThis.__nanaLiliaGetLast = function __nanaLiliaGetLast() {
  return globalThis.__nanaLiliaLast || { ok: false, error: "no last result" };
};

globalThis.__nanaLiliaCompleteSetup = function __nanaLiliaCompleteSetup() {
  return kick(completeSetupFromHost, {});
};

globalThis.__nanaLiliaForceTheme = function __nanaLiliaForceTheme(theme?: unknown) {
  const next = theme === "dark" ? "dark" : "light";
  try {
    localStorage.setItem("lilia-github.theme", next);
  } catch (_err) {}
  try {
    if (globalThis.document && globalThis.document.documentElement) {
      globalThis.document.documentElement.dataset.theme = next;
    }
  } catch (_err) {}
  try {
    hostCall("setDocumentTheme", [next]);
  } catch (_err) {}
  try {
    useTheme().setTheme(next);
  } catch (_err) {}
  try {
    hostCall("resolveLayout", []);
  } catch (_err) {}
  return { ok: true, theme: next };
};

/** Phase E / X3 — open Dialog/Drawer/ContextMenu (+ Dropdown→Select) on Nana Overlay path. */
globalThis.__nanaLiliaOpenOverlays = function __nanaLiliaOpenOverlays() {
  const host = globalThis.__nanaOverlayEvidence;
  if (!host || typeof host.openAll !== "function") {
    return { ok: false, error: "overlay evidence host not mounted" };
  }
  return host.openAll();
};

globalThis.__nanaLiliaCloseOverlays = function __nanaLiliaCloseOverlays() {
  const host = globalThis.__nanaOverlayEvidence;
  if (!host || typeof host.closeAll !== "function") {
    return { ok: false, error: "overlay evidence host not mounted" };
  }
  return host.closeAll();
};

globalThis.__nanaLiliaGetOverlayState = function __nanaLiliaGetOverlayState() {
  const host = globalThis.__nanaOverlayEvidence;
  if (!host || typeof host.snapshot !== "function") {
    return { ok: false, error: "overlay evidence host not mounted" };
  }
  return host.snapshot();
};
