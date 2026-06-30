import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import {
  installContextMenu,
  installGlobalScrollbarVisibility,
  setLiliaAppConfig,
  useCornerStyle,
  useTheme,
  vContextMenu,
} from "@lilia/ui";
import { installAgentDebugHarness } from "./agentDebug/harness";
import { LILIA_UI_CONFIG } from "./config/appShell";
import "@lilia/ui/styles.css";
import "@lilia/ui/styles/shell.css";
import "@lilia/ui/styles/page.css";
import "./styles.css";
import "./styles/page.css";
import "./styles/diffCodeTokens.css";

setLiliaAppConfig(LILIA_UI_CONFIG);
useTheme();
useCornerStyle();
installContextMenu();
installGlobalScrollbarVisibility();

const app = createApp(App);
app.use(router);
app.directive("context-menu", vContextMenu);
app.mount("#root");
installAgentDebugHarness(router);
