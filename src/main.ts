import { createLiliaGithubApp } from "./createLiliaGithubApp";
import "./ui/styles.css";
import "./styles.css";
import "./styles/page.css";
import "./styles/diffCodeTokens.css";

const { app } = createLiliaGithubApp();
app.mount("#root");
