import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./composables/useTheme";
import "./composables/useCornerStyle";
import { installContextMenu } from "./composables/useContextMenu";
import { vContextMenu } from "./directives/contextMenu";
import "./styles.css";

installContextMenu();

const app = createApp(App);
app.use(router);
app.directive("context-menu", vContextMenu);
app.mount("#root");
