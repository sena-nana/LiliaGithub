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
import type { RouterHistory } from "vue-router";
import { createLiliaGithubRouter } from "./router";
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
  installNativeAppearance();
  if (LILIA_AGENT_DEBUG_ENABLED) installAgentDebugHarness({ enabled: true });

  return { app, router };
}
