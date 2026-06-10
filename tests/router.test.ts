import { render, screen } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it } from "vitest";
import App from "../src/App.vue";
import { createLiliaGithubRouter } from "../src/router";

async function renderAt(path: string) {
  const router = createLiliaGithubRouter(createMemoryHistory());
  await router.push(path);
  await router.isReady();

  render(App, {
    global: {
      plugins: [router],
    },
  });
}

describe("基础路由", () => {
  it("默认首页显示模板占位内容", async () => {
    await renderAt("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Tauri 应用模板" }),
    ).toBeInTheDocument();
  });

  it("侧边栏左下角提供设置、扩展和状态入口", async () => {
    await renderAt("/");

    expect(screen.getAllByRole("link", { name: "设置" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "扩展" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "模板状态正常。点击进入设置。" }),
    ).toHaveClass("sb-conn--ok");
  });

  it("设置页默认显示外观设置并使用设置侧栏", async () => {
    await renderAt("/settings");

    expect(await screen.findByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /外观/ })).toHaveClass("is-active");
    expect(screen.queryByText(/Claude|Codex|CC-Switch|agent/i)).toBeNull();
  });

  it("设置页可通过 tab query 显示关于页，未知 tab 回落外观", async () => {
    await renderAt("/settings?tab=about");

    expect(await screen.findByRole("heading", { level: 1, name: "关于" })).toBeInTheDocument();
    expect(await screen.findByText("Tauri 2 + Vue 3")).toBeInTheDocument();
  });

  it("扩展页显示模板占位内容", async () => {
    await renderAt("/plugins");

    expect(await screen.findByRole("heading", { level: 1, name: "扩展" })).toBeInTheDocument();
    expect(screen.getByText("当前模板不包含 Lilia 的真实插件管理逻辑。")).toBeInTheDocument();
  });

  it("未知路由回到首页", async () => {
    await renderAt("/missing");

    expect(await screen.findByText("从这里开始替换成你的业务页面。")).toBeInTheDocument();
  });

  it("未知设置 tab 回落到外观", async () => {
    await renderAt("/settings?tab=missing");

    expect(await screen.findByRole("heading", { level: 1, name: "外观" })).toBeInTheDocument();
  });
});
