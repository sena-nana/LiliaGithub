#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle");
const nativeCpuFlag = "-C target-cpu=native";
const dryRun = process.env.TAURI_TEMPLATE_INSTALL_DRY_RUN === "1";
const platform = process.platform;
const platformTargets = {
  win32: { dirs: ["msi", "nsis"], exts: [".msi", ".exe"] },
  darwin: { dirs: ["dmg"], exts: [".dmg"] },
  linux: { dirs: ["appimage", "deb", "rpm"], exts: [".appimage", ".deb", ".rpm"] },
};

function installCommand(installerPath) {
  if (platform === "win32") {
    return [path.extname(installerPath).toLowerCase() === ".msi" ? "msiexec" : installerPath, path.extname(installerPath).toLowerCase() === ".msi" ? ["/i", installerPath, "/qn"] : ["/S"]];
  }
  if (platform === "darwin") return ["open", [installerPath]];
  if (platform === "linux") return ["xdg-open", [installerPath]];
  throw new Error(`不支持的系统: ${platform}`);
}

function latestInstaller(target) {
  const candidates = [];

  for (const dir of target.dirs) {
    const dirPath = path.join(bundleDir, dir);
    if (!existsSync(dirPath)) continue;

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (!target.exts.includes(path.extname(fullPath).toLowerCase())) continue;
      candidates.push(fullPath);
    }
  }

  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result;
}

function nativeBuildEnv() {
  const env = { ...process.env };
  const rustflags = env.RUSTFLAGS?.trim();
  env.RUSTFLAGS = rustflags && !rustflags.includes("target-cpu=") ? `${rustflags} ${nativeCpuFlag}` : rustflags || nativeCpuFlag;
  return env;
}

function buildCommand() {
  if (platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "yarn.cmd tauri build"],
    };
  }

  return { command: "yarn", args: ["tauri", "build"] };
}

function yarnBuild() {
  const env = nativeBuildEnv();
  const { command, args } = buildCommand();

  if (dryRun) {
    console.log(JSON.stringify({ command, args, env: { RUSTFLAGS: env.RUSTFLAGS } }, null, 2));
    return;
  }

  run(command, args, { env });
}

function main() {
  yarnBuild();
  if (dryRun) return;

  if (!existsSync(bundleDir)) {
    throw new Error(`未找到 release 产物目录: ${bundleDir}，请先执行 yarn tauri:build`);
  }

  const target = platformTargets[platform];
  if (!target) throw new Error(`不支持的操作系统: ${platform}`);

  const installerPath = latestInstaller(target);
  if (!installerPath) {
    throw new Error(`未找到可安装文件，支持后缀: ${target.exts.join(" ")}`);
  }

  const [command, args] = installCommand(installerPath);
  run(command, args);
  console.log(`[lilia-github] 已发起安装: ${installerPath}`);
}

main();
