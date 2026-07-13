import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type TauriInstallDryRun = {
  platform: NodeJS.Platform;
  build: {
    command: string;
    args: string[];
    env: { RUSTFLAGS: string };
  };
  artifact: {
    kind: "executable" | "app";
    path: string;
  };
  shortcut: {
    kind: "windows-lnk" | "macos-app-symlink" | "linux-desktop-entry";
    path: string;
    target: string;
  };
};

function runTauriInstallDryRun(rustflags: string) {
  return spawnSync(
    process.execPath,
    [resolve("node_modules/@lilia/build/bin/lilia-build.mjs"), "tauri-install"],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        LILIA_GITHUB_INSTALL_DRY_RUN: "1",
        RUSTFLAGS: rustflags,
      },
      encoding: "utf-8",
    },
  );
}

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

  it("共享 Tauri install CLI 规划 release 产物和桌面快捷方式", () => {
    const run = runTauriInstallDryRun("-C debuginfo=0");

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as TauriInstallDryRun;
    const expected = {
      win32: {
        artifactKind: "executable",
        artifactSuffix: ".exe",
        shortcutKind: "windows-lnk",
        shortcutSuffix: ".lnk",
        buildArgs: ["build", "--no-bundle"],
      },
      darwin: {
        artifactKind: "app",
        artifactSuffix: ".app",
        shortcutKind: "macos-app-symlink",
        shortcutSuffix: ".app",
        buildArgs: ["build", "--bundles", "app"],
      },
      linux: {
        artifactKind: "executable",
        artifactSuffix: "",
        shortcutKind: "linux-desktop-entry",
        shortcutSuffix: ".desktop",
        buildArgs: ["build", "--no-bundle"],
      },
    }[process.platform];

    if (!expected) throw new Error(`不支持的测试平台: ${process.platform}`);
    expect(parsed.platform).toBe(process.platform);
    expect(parsed.build.command).toBe(process.execPath);
    expect(parsed.build.args.slice(-expected.buildArgs.length)).toEqual(expected.buildArgs);
    expect(parsed.build.env.RUSTFLAGS).toBe("-C debuginfo=0 -C target-cpu=native");
    expect(parsed.artifact.kind).toBe(expected.artifactKind);
    expect(resolve(parsed.artifact.path)).toBe(parsed.artifact.path);
    if (process.platform === "darwin") {
      expect(parsed.artifact.path).toContain(`${sep}bundle${sep}macos${sep}`);
    } else {
      expect(parsed.artifact.path).not.toContain(`${sep}bundle${sep}`);
    }
    expect(parsed.artifact.path.toLowerCase().endsWith(expected.artifactSuffix)).toBe(true);
    expect(parsed.shortcut.kind).toBe(expected.shortcutKind);
    expect(resolve(parsed.shortcut.path)).toBe(parsed.shortcut.path);
    expect(parsed.shortcut.path.toLowerCase().endsWith(expected.shortcutSuffix)).toBe(true);
    expect(parsed.shortcut.target).toBe(parsed.artifact.path);
  });

  it("共享 Tauri install CLI 不覆盖显式 target-cpu 配置", () => {
    const run = runTauriInstallDryRun("-C target-cpu=x86-64-v3");

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as TauriInstallDryRun;
    expect(parsed.build.env.RUSTFLAGS).toBe("-C target-cpu=x86-64-v3");
  });
});
