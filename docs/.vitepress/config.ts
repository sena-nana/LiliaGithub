import { defineConfig } from "vitepress";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isProjectPages = repository && !repository.endsWith(".github.io");
const base = process.env.GITHUB_ACTIONS && isProjectPages ? `/${repository}/` : "/";

export default defineConfig({
  title: "LiliaGithub",
  description: "A desktop workbench for local Git and day-to-day GitHub operations.",
  base,
  themeConfig: {
    nav: [{ text: "开发启动", link: "/guide/development" }],
    sidebar: [
      {
        text: "指南",
        items: [{ text: "开发启动", link: "/guide/development" }],
      },
      {
        text: "设计",
        items: [{ text: "Agent Debug Harness", link: "/design/agent-debug-harness" }],
      },
    ],
    socialLinks: [],
  },
});
