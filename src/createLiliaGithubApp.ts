import { createApp } from "vue";
import { installAgentDebugHarness } from "@lilia/ui/diagnostics";
import {
  installCornerStyle,
  installGlobalScrollbarVisibility,
  installLiliaContextMenu,
  installNativeAppearance,
} from "@lilia/ui/runtime";
import { provideLiliaSettings } from "@lilia/ui/settings";
import { setLiliaUiConfig } from "@lilia/ui/shell";
import { installTauriNativeAppearanceAdapter } from "@lilia/ui/runtime/tauri";
import type { RouterHistory } from "vue-router";
import { createLiliaGithubRouter } from "./router";
import {
  createSessionContext,
  provideSessionContext,
  type SessionContext,
} from "./composables/sessionContext";
import { installLiliaGithubAgentDebugCompat } from "./agentDebug/compat";
import {
  LILIA_AGENT_DEBUG_ENABLED,
  LILIA_SETTINGS_MODEL,
  LILIA_UI_CONFIG,
} from "./config/appShell";
import AppRoot from "./app/AppRoot.vue";
import { createDefaultWorkspaceTransport } from "./services/workspace/client";
import {
  createWorkspaceStore,
  provideWorkspaceStore,
  type CreateWorkspaceStoreOptions,
  type WorkspaceStore,
} from "./composables/workspace/store";

export interface CreateLiliaGithubAppOptions {
  history?: RouterHistory;
  workspace?: WorkspaceStore;
  workspaceOptions?: Omit<CreateWorkspaceStoreOptions, "sessionContext">;
  sessionContext?: SessionContext;
}

export function createLiliaGithubApp(options: CreateLiliaGithubAppOptions = {}) {
  const sessionContext = options.sessionContext ?? options.workspace?.sessionContext ?? createSessionContext();
  if (options.workspace && options.workspace.sessionContext !== sessionContext) {
    throw new Error("The app router and workspace store must share one SessionContext.");
  }
  const router = createLiliaGithubRouter(sessionContext, options.history);
  const app = createApp(AppRoot);
  const workspace = options.workspace ?? createWorkspaceStore({
    transport: createDefaultWorkspaceTransport(),
    ...options.workspaceOptions,
    sessionContext,
  });

  setLiliaUiConfig(LILIA_UI_CONFIG);
  provideLiliaSettings(app, LILIA_SETTINGS_MODEL);
  provideSessionContext(app, sessionContext);
  provideWorkspaceStore(app, workspace);
  app.use(router);
  installLiliaContextMenu(app);
  installGlobalScrollbarVisibility();
  installCornerStyle();
  installTauriNativeAppearanceAdapter();
  installNativeAppearance();
  if (LILIA_AGENT_DEBUG_ENABLED) {
    installAgentDebugHarness({ enabled: true });
    const cleanupAgentDebugCompat = installLiliaGithubAgentDebugCompat();
    app.onUnmount(cleanupAgentDebugCompat);
  }

  return { app, router, workspace, sessionContext };
}
