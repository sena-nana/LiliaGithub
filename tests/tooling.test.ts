import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function scriptEnv(extra: Record<string, string>) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "npm_config_user_agent") {
      delete env[key];
    }
  }
  return {
    ...env,
    ...extra,
  };
}

describe("单应用模板工具链", () => {
  it("根 package.json 直接提供单应用脚本，不包含 workspace", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.packageManager).toBe("yarn@4.14.1");
    expect(pkg.scripts).toMatchObject({
      "check:package-manager": "node scripts/check-package-manager.mjs",
      dev: "vite",
      build: "vue-tsc --noEmit && vite build",
      test: "vitest run",
      "docs:dev": "vitepress dev docs",
      "docs:build": "vitepress build docs",
      "docs:preview": "vitepress preview docs",
      tauri: "tauri",
      "tauri:dev": "node scripts/tauri-dev.mjs",
      "tauri:build": "tauri build",
      verify: "yarn test && yarn build && cargo check --manifest-path src-tauri/Cargo.toml",
    });
  });

  it("只保留通用 Tauri/Vue 依赖，不包含 Lilia agent 业务依赖", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(deps.vue).toBeDefined();
    expect(deps["vue-router"]).toBeDefined();
    expect(deps["@tauri-apps/api"]).toBeDefined();
    expect(deps["@tauri-apps/plugin-store"]).toBeDefined();
    expect(deps.vitepress).toBeDefined();
    expect(deps["@anthropic-ai/claude-agent-sdk"]).toBeUndefined();
    expect(deps["@openai/codex-sdk"]).toBeUndefined();
    expect(deps["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(deps["@lilia/contracts"]).toBeUndefined();
    expect(deps.zod).toBeUndefined();
  });

  it("Rust 端包含 Git/GitHub MVP 所需插件和依赖，不引入 Lilia agent 存储", () => {
    const cargo = readFileSync(resolve("src-tauri/Cargo.toml"), "utf-8");

    expect(cargo).toContain('tauri-plugin-store = "2"');
    expect(cargo).toContain('tauri-plugin-dialog = "2"');
    expect(cargo).toContain("reqwest");
    expect(cargo).toContain("keyring");
    expect(cargo).toContain("base64");
    expect(cargo).not.toContain("rusqlite");
    expect(cargo).not.toContain("r2d2");
  });

  it("包管理器检查接受 Yarn 4 并拒绝其他入口", () => {
    const ok = spawnSync("node", ["scripts/check-package-manager.mjs"], {
      cwd: resolve("."),
      env: scriptEnv({
        npm_config_user_agent: "yarn/4.14.1 npm/? node/?",
      }),
      encoding: "utf-8",
    });
    expect(ok.status).toBe(0);

    const bad = spawnSync("node", ["scripts/check-package-manager.mjs"], {
      cwd: resolve("."),
      env: scriptEnv({
        npm_config_user_agent: "npm/11.0.0 node/?",
      }),
      encoding: "utf-8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("LiliaGithub requires Yarn 4 through Corepack.");
  });

  it("Tauri dev 脚本 dry-run 输出动态端口配置", () => {
    const run = spawnSync("node", ["scripts/tauri-dev.mjs", "--verbose"], {
      cwd: resolve("."),
      env: {
        ...process.env,
        LILIA_GITHUB_DEV_DRY_RUN: "1",
        LILIA_GITHUB_DEV_PORT: "34120",
      },
      encoding: "utf-8",
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      args: string[];
      devUrl: string;
      env: Record<string, string>;
    };
    expect(parsed.devUrl).toBe("http://localhost:34120");
    expect(parsed.args).toContain("tauri");
    expect(parsed.args).toContain("dev");
    expect(parsed.args).toContain("--config");
    expect(parsed.args).toContain("--verbose");
    expect(parsed.env).toMatchObject({
      LILIA_GITHUB_DEV_PORT: "34120",
      LILIA_GITHUB_DEV_STRICT_PORT: "1",
    });
  });

  it("GitHub workflow 使用模板路径和通用发布配置", () => {
    const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf-8");
    const release = readFileSync(resolve(".github/workflows/release.yml"), "utf-8");
    const pages = readFileSync(resolve(".github/workflows/pages.yml"), "utf-8");
    const combined = [ci, release, pages].join("\n");

    expect(ci).toContain("corepack yarn verify");
    expect(ci).toContain("corepack yarn docs:build");
    expect(ci).toContain("src-tauri/target");
    expect(release).toContain("projectPath: .");
    expect(release).toContain("releaseName: LiliaGithub");
    expect(pages).toContain("docs/.vitepress/dist");
    expect(pages).not.toContain("enablement: true");
    expect(combined).not.toContain("apps/desktop");
    expect(combined).not.toContain("LiliaCode");
  });

  it("GitHub Issue 模板不包含 Lilia 业务字段", () => {
    const bug = readFileSync(resolve(".github/ISSUE_TEMPLATE/bug_report.yml"), "utf-8");
    const feature = readFileSync(
      resolve(".github/ISSUE_TEMPLATE/feature_request.yml"),
      "utf-8",
    );
    const combined = `${bug}\n${feature}`;

    expect(combined).toContain("模板版本 / commit");
    expect(combined).toContain("构建 / 发布");
    expect(combined).not.toContain("Lilia 版本");
    expect(combined).not.toContain("Backend");
    expect(combined).not.toContain("Agent");
    expect(combined).not.toContain("Memory");
    expect(combined).not.toContain("Roadmap");
  });
});

describe("Lilia 外壳样式迁移", () => {
  it("保留侧栏折叠时的宽度、拖拽线和 reduced-motion 动效规则", () => {
    const shellCss = readFileSync(resolve("src/styles/shell.css"), "utf-8");

    expect(shellCss).toContain("transition: grid-template-columns 0.24s var(--sidebar-easing)");
    expect(shellCss).toContain("left 0.24s var(--sidebar-easing)");
    expect(shellCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("保留 Lilia 的透明按钮基线和显式强调态", () => {
    const styles = readFileSync(resolve("src/styles.css"), "utf-8").replace(/\r\n/g, "\n");

    expect(styles).toContain("button {\n  background: transparent");
    expect(styles).toContain("button.primary");
    expect(styles).toContain("background: var(--accent-soft)");
    expect(styles).toContain("button.ghost.danger:hover");
    expect(styles).toContain("background: transparent");
  });

  it("保留 Lilia 侧边栏行内工具样式并接入仓库同步入口", () => {
    const secondaryPanel = readFileSync(resolve("src/layouts/SecondaryPanel.vue"), "utf-8");
    const rowTools = readFileSync(resolve("src/components/sidebar/SidebarRowTools.vue"), "utf-8");

    expect(rowTools).toContain("class=\"sb-tree__hover-tools\"");
    expect(rowTools).toContain(".sb-tree__hover-tools");
    expect(rowTools).toContain("opacity: 0");
    expect(rowTools).toContain("pointer-events: none");
    expect(secondaryPanel).toContain("拉取预检");
    expect(secondaryPanel).toContain("推送预检");
    expect(secondaryPanel).toContain("workspace.state.repos");
  });
});
