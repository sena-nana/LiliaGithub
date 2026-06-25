#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle");

const platformTargets = {
  win32: { dirs: ["msi", "nsis"], exts: [".msi", ".exe"] },
  darwin: { dirs: ["dmg"], exts: [".dmg"] },
  linux: { dirs: ["appimage", "deb", "rpm"], exts: [".appimage", ".deb", ".rpm"] },
};

const installCommand = {
  win32(installerPath) {
    if (path.extname(installerPath).toLowerCase() === ".msi") {
      return spawnSync("msiexec", ["/i", installerPath, "/qn"], { stdio: "inherit" });
    }
    return spawnSync(installerPath, ["/S"], { stdio: "inherit" });
  },
  darwin: (installerPath) => spawnSync("open", [installerPath], { stdio: "inherit" }),
  linux: (installerPath) => spawnSync("xdg-open", [installerPath], { stdio: "inherit" }),
};

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

function main() {
  if (!existsSync(bundleDir)) {
    throw new Error(`未找到 release 产物目录: ${bundleDir}，请先执行 yarn tauri:build`);
  }

  const target = platformTargets[process.platform];
  if (!target) {
    throw new Error(`不支持的操作系统: ${process.platform}`);
  }

  const installerPath = latestInstaller(target);
  if (!installerPath) {
    throw new Error(`未找到可安装文件，支持后缀: ${target.exts.join(" ")}`);
  }

  const runner = installCommand[process.platform];
  const result = runner(installerPath);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`安装返回错误码: ${result.status}`);
  }

  console.log(`[lilia-github] 已发起安装: ${installerPath}`);
}

main();
