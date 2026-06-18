import { existsSync, readFileSync } from "node:fs";
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

function rustFunctionBody(source: string, name: string) {
  const start = source.indexOf(`fn ${name}`);
  const commandStart = source.lastIndexOf("#[tauri::command]", start);
  if (start === -1 || commandStart === -1) {
    throw new Error(`Rust command not found: ${name}`);
  }
  const nextCommand = source.indexOf("#[tauri::command]", start);
  return source.slice(commandStart, nextCommand === -1 ? undefined : nextCommand);
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

  it("GitHub OAuth 设备授权请求显式协商 JSON 响应并保留错误详情", () => {
    const github = readFileSync(resolve("src-tauri/src/workspace/github.rs"), "utf-8");
    const startDeviceFlow = rustFunctionBody(github, "github_start_device_flow");
    const pollDeviceFlow = rustFunctionBody(github, "github_poll_device_flow");

    expect(github).toContain('const GITHUB_OAUTH_ACCEPT: &str = "application/json";');
    expect(github).toContain('const GITHUB_SCOPE: &str = "repo workflow read:user delete_repo";');
    expect(github).toContain("fn github_oauth_headers");
    expect(github).toContain("fn github_http_error");
    expect(startDeviceFlow).toContain(".post(\"https://github.com/login/device/code\")");
    expect(startDeviceFlow).toContain("github_oauth_headers(");
    expect(startDeviceFlow).toContain('github_http_error("启动 GitHub 设备授权失败", response)');
    expect(pollDeviceFlow).toContain(".post(\"https://github.com/login/oauth/access_token\")");
    expect(pollDeviceFlow).toContain("github_oauth_headers(");
    expect(pollDeviceFlow).toContain('github_http_error("轮询 GitHub 授权失败", response)');
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

  it("全局滚动条使用隐藏原生条和 overlay 显隐样式", () => {
    const styles = readFileSync(resolve("src/styles.css"), "utf-8").replace(/\r\n/g, "\n");
    const main = readFileSync(resolve("src/main.ts"), "utf-8");
    const scrollbars = readFileSync(resolve("src/composables/useGlobalScrollbarVisibility.ts"), "utf-8");

    expect(styles).toContain("scrollbar-width: none");
    expect(styles).toContain("::-webkit-scrollbar {\n  width: 0;\n  height: 0;");
    expect(styles).toContain(".global-scrollbar-overlay");
    expect(styles).toContain("transition: opacity 0.48s ease");
    expect(styles).toContain(".global-scrollbar-overlay.is-visible");
    expect(styles).toContain(".global-scrollbar-overlay--vertical::before {\n  top: 0;\n  right: 0;");
    expect(main).toContain(
      'import { installGlobalScrollbarVisibility } from "./composables/useGlobalScrollbarVisibility"',
    );
    expect(scrollbars).toContain("export function installGlobalScrollbarVisibility()");
    expect(scrollbars).toContain("export function uninstallGlobalScrollbarVisibility()");
  });

  it("主界面高度由 CSS 网格约束，不依赖加载后测量卡片高度", () => {
    const home = readFileSync(resolve("src/pages/Home.vue"), "utf-8").replace(/\r\n/g, "\n");

    expect(existsSync(resolve("src/composables/useRepoOverviewCardHeight.ts"))).toBe(false);
    expect(home).not.toContain("useRepoOverviewCardHeight");
    expect(home).not.toContain("--repo-overview-card-max-height");
    expect(home).toContain('<section class="home-page"');
    expect(home).toContain("grid-template-rows: auto auto minmax(0, 1fr);");
    expect(home).toContain("overflow: hidden;");
    expect(home).toContain("grid-template-rows: minmax(0, 1fr);");
    expect(home).toContain(".home-scroll-card__body {\n  flex: 1 1 auto;");
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
