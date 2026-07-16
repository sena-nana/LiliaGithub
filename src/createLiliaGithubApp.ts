import { createApp } from "vue";
import { installAgentDebugHarness } from "@lilia/ui/diagnostics";
import {
  installCornerStyle,
  installGlobalScrollbarVisibility,
  installLiliaContextMenu,
  installNativeAppearance,
} from "@lilia/ui/runtime";
import { provideLiliaSettings } from "@lilia/ui/settings";
import { liliaShellOptionsKey, setLiliaUiConfig } from "@lilia/ui/shell";
import type { RouterHistory } from "vue-router";
import { createLiliaGithubRouter } from "./router";
import {
  LILIA_AGENT_DEBUG_ENABLED,
  LILIA_SETTINGS_MODEL,
  LILIA_UI_CONFIG,
} from "./config/appShell";
import { useWorkspace } from "./composables/useWorkspace";
import AppRoot from "./app/AppRoot.vue";
import SecondaryPanel from "./layouts/SecondaryPanel.vue";

export interface CreateLiliaGithubAppOptions {
  history?: RouterHistory;
}

export function createLiliaGithubApp(options: CreateLiliaGithubAppOptions = {}) {
  const workspace = useWorkspace();
  const router = createLiliaGithubRouter(options.history);
  const setupOverlayActive = () => (router.currentRoute.value.path || window.location.pathname) === "/" &&
    !workspace.isReady.value;
  const app = createApp(AppRoot);

  setLiliaUiConfig(LILIA_UI_CONFIG);
  provideLiliaSettings(app, LILIA_SETTINGS_MODEL);
  app.provide(liliaShellOptionsKey, {
    mainSidebar: SecondaryPanel,
    setupOverlayActive,
  });
  app.use(router);
  installLiliaContextMenu(app);
  installGlobalScrollbarVisibility();
  installCornerStyle();
  installNativeAppearance();
  if (LILIA_AGENT_DEBUG_ENABLED) installAgentDebugHarness({ enabled: true });

  return { app, router };
}
