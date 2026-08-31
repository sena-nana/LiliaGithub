/**
 * Nana host composition root — mirrors createLiliaGithubApp but:
 * - uses Nana Custom Renderer createApp (injected)
 * - skips installTauriNativeAppearanceAdapter
 * - forces mock workspace transport
 * - uses createMemoryHistory by default
 */
import {
  installCornerStyle,
  installGlobalScrollbarVisibility,
  installLiliaContextMenu,
  installNativeAppearance,
} from "@lilia/ui/runtime";
import { createLiliaSettingsModel, provideLiliaSettings } from "@lilia/ui/settings";
import { setLiliaUiConfig } from "@lilia/ui/shell";
import { NanaAppearancePanel } from "@nanaui/nanavue-components";
import {
  createMemoryHistory,
  type RouterHistory,
} from "vue-router";
import type { App, Component } from "vue";
import {
  createSessionContext,
  provideSessionContext,
  type SessionContext,
} from "../composables/sessionContext";
import {
  DEFAULT_SETTINGS_TAB,
  LILIA_UI_CONFIG,
  SETTINGS_TABS,
} from "../config/appShell";
import {
  createWorkspaceStore,
  provideWorkspaceStore,
  type CreateWorkspaceStoreOptions,
  type WorkspaceStore,
} from "../composables/workspace/store";
import NanaAppRoot from "./NanaAppRoot.vue";
import { createNanaCriticalRouter } from "./router";
import { createNanaMockWorkspaceTransport } from "./mockTransport";
import NanaAboutSection from "./settings/NanaAboutSection.vue";
import NanaAccountSection from "./settings/NanaAccountSection.vue";
import NanaWorkspaceSection from "./settings/NanaWorkspaceSection.vue";

/** Settings: Appearance stays NanaAppearancePanel; other tabs are real Nana sections. */
const NANA_SETTINGS_MODEL = createLiliaSettingsModel({
  path: "/settings",
  defaultTab: DEFAULT_SETTINGS_TAB,
  description: "管理外观、账户、工作区和应用信息。",
  tabs: SETTINGS_TABS,
  sections: {
    appearance: NanaAppearancePanel,
    account: NanaAccountSection,
    repositories: NanaWorkspaceSection,
    about: NanaAboutSection,
  },
});

export interface CreateLiliaGithubNanaAppOptions {
  createApp: (root: Component) => App;
  history?: RouterHistory;
  workspace?: WorkspaceStore;
  workspaceOptions?: Omit<CreateWorkspaceStoreOptions, "sessionContext">;
  sessionContext?: SessionContext;
  /** Start with workspace ready (has root + github bound mock). */
  startReady?: boolean;
}

export function createLiliaGithubNanaApp(options: CreateLiliaGithubNanaAppOptions) {
  const sessionContext =
    options.sessionContext ??
    options.workspace?.sessionContext ??
    createSessionContext();
  if (options.workspace && options.workspace.sessionContext !== sessionContext) {
    throw new Error("The app router and workspace store must share one SessionContext.");
  }

  const history = options.history ?? createMemoryHistory();
  const router = createNanaCriticalRouter(history);
  const app = options.createApp(NanaAppRoot);

  const baseTransport =
    options.workspaceOptions?.transport ??
    createNanaMockWorkspaceTransport({ startReady: !!options.startReady });

  const transport = {
    async invoke(command: string, args: unknown, invokeOptions?: unknown) {
      const result = await baseTransport.invoke(command as never, args as never, invokeOptions as never);
      if (command === "github_list_repos") {
        const page = result as { items?: unknown; nextPage?: unknown; scope?: unknown } | null;
        if (!page || !Array.isArray(page.items)) {
          return {
            items: [],
            nextPage: null,
            scope: { kind: "all" },
          } as never;
        }
        return {
          items: page.items,
          nextPage: page.nextPage ?? null,
          scope: page.scope ?? { kind: "all" },
        } as never;
      }
      if (
        command === "github_list_action_notifications" ||
        command === "github_list_account_issues" ||
        command === "github_list_pull_requests" ||
        command === "github_list_repo_owners" ||
        command === "workspace_refresh_repos" ||
        command === "workspace_list_managed_repos" ||
        command === "workspace_scan_repos" ||
        command === "workspace_discover_repos" ||
        command === "workspace_list_local_repos" ||
        command === "workspace_list_tasks"
      ) {
        return (Array.isArray(result) ? result : []) as never;
      }
      if (command === "github_list_home_attention") {
        const attention = result as {
          pendingPullRequests?: { items?: unknown; failures?: unknown };
          workflowRuns?: { items?: unknown; failures?: unknown };
        } | null;
        if (
          !attention ||
          !attention.pendingPullRequests ||
          !Array.isArray(attention.pendingPullRequests.items) ||
          !Array.isArray(attention.pendingPullRequests.failures) ||
          !attention.workflowRuns ||
          !Array.isArray(attention.workflowRuns.items) ||
          !Array.isArray(attention.workflowRuns.failures)
        ) {
          return {
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
          } as never;
        }
        return attention as never;
      }
      if (command === "github_list_watched_repos") {
        const page = result as { items?: unknown; nextPage?: unknown } | null;
        if (!page || !Array.isArray(page.items)) {
          return { items: [], nextPage: null } as never;
        }
        return page as never;
      }
      return result;
    },
  };

  const workspace =
    options.workspace ??
    createWorkspaceStore({
      transport,
      ...options.workspaceOptions,
      sessionContext,
    });

  setLiliaUiConfig(LILIA_UI_CONFIG);
  provideLiliaSettings(app, NANA_SETTINGS_MODEL);
  provideSessionContext(app, sessionContext);
  provideWorkspaceStore(app, workspace);
  app.use(router);
  installLiliaContextMenu(app);
  installGlobalScrollbarVisibility();
  installCornerStyle();
  // Intentionally skip installTauriNativeAppearanceAdapter — Nana has no Tauri.
  installNativeAppearance();

  return { app, router, workspace, sessionContext };
}
