#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle");
const nativeCpuFlag = "-C target-cpu=native";
const dryRun = process.env.LILIA_GITHUB_INSTALL_DRY_RUN === "1";
const platform = process.platform;
const platformTargets = {
  win32: { dirs: ["nsis"], exts: [".exe"] },
  darwin: { dirs: ["dmg"], exts: [".dmg"] },
  linux: { dirs: ["appimage", "deb", "rpm"], exts: [".appimage", ".deb", ".rpm"] },
};
const appDisplayName = "LiliaGithub";
const legacyWindowsInstallDir = "C:\\LiliaGithub_Test";

function installCommand(installerPath) {
  if (platform === "win32") {
    return [installerPath, ["/S"]];
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
  const { capture = false, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    ...spawnOptions,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf-8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = capture ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${output ? `\n${output}` : ""}`);
  }
  return capture ? result.stdout ?? "" : result;
}

function powershell(command) {
  return run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ], { capture: true });
}

function prepareWindowsInstall() {
  powershell(String.raw`
$name = '${appDisplayName}'
$legacy = '${legacyWindowsInstallDir}'

$paths = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$installs = Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object {
    $location = (([string]$_.InstallLocation -replace '^"|"$','') -replace '\\+$','')
    $icon = [string]$_.DisplayIcon -replace '^"|"$',''
    $_.DisplayName -eq $name -and (
      $location -ieq $legacy -or
      $icon.StartsWith("$legacy\", [StringComparison]::OrdinalIgnoreCase)
    )
  }
if (-not $installs) { return }

$running = Get-CimInstance Win32_Process -Filter "Name = 'lilia_github.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($legacy, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  $processes = ($running | ForEach-Object { "$($_.ProcessId): $($_.ExecutablePath)" }) -join ', '
  throw "检测到旧安装目录中的 $name 仍在运行，请先结束进程后重试：$processes"
}

foreach ($install in $installs) {
  $command = if ($install.QuietUninstallString) { $install.QuietUninstallString } else { $install.UninstallString }
  if (-not $command) { throw "检测到旧安装目录 $legacy，但卸载命令为空，请先手动卸载 $name" }
  if ($command -notmatch '(^|\s)/S($|\s)') { $command = "$command /S" }
  $source = if ($install.InstallLocation) { $install.InstallLocation } else { $install.DisplayIcon }
  Write-Host "[lilia-github] 卸载旧测试目录安装: $source"
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', $command) -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "旧安装卸载失败，退出码：$($process.ExitCode)" }
}
`);
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

  if (platform === "win32") prepareWindowsInstall();
  const [command, args] = installCommand(installerPath);
  run(command, args);
  console.log(`[lilia-github] 已发起安装: ${installerPath}`);
}

main();
