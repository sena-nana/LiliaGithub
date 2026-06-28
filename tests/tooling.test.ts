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

describe("工具链行为", () => {
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

  it("Tauri install 脚本默认为本机 CPU 优化 release 打包", () => {
    const run = spawnSync("node", ["scripts/tauri-install.mjs"], {
      cwd: resolve("."),
      env: {
        ...process.env,
        LILIA_GITHUB_INSTALL_DRY_RUN: "1",
        RUSTFLAGS: "-C debuginfo=0",
      },
      encoding: "utf-8",
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      args: string[];
      env: Record<string, string>;
    };
    expect(parsed.args.join(" ")).toContain("tauri build");
    expect(parsed.env.RUSTFLAGS).toBe("-C debuginfo=0 -C target-cpu=native");
  });

  it("Tauri install 脚本不覆盖显式 target-cpu 配置", () => {
    const run = spawnSync("node", ["scripts/tauri-install.mjs"], {
      cwd: resolve("."),
      env: {
        ...process.env,
        LILIA_GITHUB_INSTALL_DRY_RUN: "1",
        RUSTFLAGS: "-C target-cpu=x86-64-v3",
      },
      encoding: "utf-8",
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as {
      env: Record<string, string>;
    };
    expect(parsed.env.RUSTFLAGS).toBe("-C target-cpu=x86-64-v3");
  });
});
