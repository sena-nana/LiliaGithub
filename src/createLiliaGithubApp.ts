import { createApp } from "vue";
import {
  installAgentDebugHarness,
  installCornerStyle,
  installGlobalScrollbarVisibility,
  installLiliaContextMenu,
  installNativeAppearance,
  provideLiliaSettings,
  setLiliaUiConfig,
} from "./ui";
import { installTauriNativeAppearanceAdapter } from "@lilia/ui/runtime/tauri";
import type { RouterHistory } from "vue-router";
import { createLiliaGithubRouter } from "./router";
import { installLiliaGithubAgentDebugCompat } from "./agentDebug/compat";
import {
  LILIA_AGENT_DEBUG_ENABLED,
  LILIA_SETTINGS_MODEL,
  LILIA_UI_CONFIG,
} from "./config/appShell";
import AppRoot from "./app/AppRoot.vue";

export interface CreateLiliaGithubAppOptions {
  history?: RouterHistory;
}

export function createLiliaGithubApp(options: CreateLiliaGithubAppOptions = {}) {
  const router = createLiliaGithubRouter(options.history);
  const app = createApp(AppRoot);

  setLiliaUiConfig(LILIA_UI_CONFIG);
  provideLiliaSettings(app, LILIA_SETTINGS_MODEL);
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

  return { app, router };
}
