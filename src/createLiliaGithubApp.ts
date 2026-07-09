import { createLiliaApp } from "@lilia/ui";
import type { Router, RouterHistory } from "vue-router";
import { installLiliaGithubRouterGuards, LILIA_GITHUB_ROUTES } from "./router";
import { LILIA_UI_CONFIG } from "./config/appShell";
import { useWorkspace } from "./composables/useWorkspace";
import AppEffects from "./app/AppEffects.vue";
import SecondaryPanel from "./layouts/SecondaryPanel.vue";

export interface CreateLiliaGithubAppOptions {
  history?: RouterHistory;
}

export function createLiliaGithubApp(options: CreateLiliaGithubAppOptions = {}) {
  const workspace = useWorkspace();
  let router: Router | null = null;
  const setupOverlayActive = () => (router?.currentRoute.value.path ?? window.location.pathname) === "/" &&
    !workspace.isReady.value;
  const created = createLiliaApp({
    config: LILIA_UI_CONFIG,
    history: options.history,
    overlays: [AppEffects],
    routes: LILIA_GITHUB_ROUTES,
    shellOptions: {
      mainSidebar: SecondaryPanel,
      setupOverlayActive,
    },
  });
  router = created.router;
  installLiliaGithubRouterGuards(created.router);
  return created;
}
