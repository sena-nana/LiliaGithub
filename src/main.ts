import { createLiliaGithubApp } from "./createLiliaGithubApp";
import "@lilia/ui/styles.css";
import "@lilia/ui/styles/shell.css";
import "@lilia/ui/styles/page.css";
import "./styles.css";
import "./styles/page.css";
import "./styles/diffCodeTokens.css";

const { app } = createLiliaGithubApp();
app.mount("#root");
