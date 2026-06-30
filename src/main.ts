import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { installLiliaAppRuntime } from "@lilia/ui";
import { installAgentDebugHarness } from "./agentDebug/harness";
import { LILIA_UI_CONFIG } from "./config/appShell";
import "@lilia/ui/styles.css";
import "@lilia/ui/styles/shell.css";
import "@lilia/ui/styles/page.css";
import "./styles.css";
import "./styles/page.css";
import "./styles/diffCodeTokens.css";

const app = createApp(App);
installLiliaAppRuntime({ app, config: LILIA_UI_CONFIG });
app.use(router);
app.mount("#root");
installAgentDebugHarness(router);
