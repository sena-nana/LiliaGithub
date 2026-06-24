import type { ProjectLaunchHistoryEntry, ProjectLaunchLog, ProjectLaunchStatus } from "../services/workspace/types";

export interface LaunchDiagnostic {
  title: string;
  detail: string;
  steps: string[];
}

export function launchHistoryLabel(entry: ProjectLaunchHistoryEntry) {
  if (entry.state === "running") return "运行中";
  if (entry.state === "error") return "启动失败";
  if (entry.exitCode == null || entry.exitCode === 0) return "正常结束";
  return `退出 ${entry.exitCode}`;
}

export function launchDiagnostic(
  status: ProjectLaunchStatus | null,
  logs: readonly ProjectLaunchLog[],
  history: readonly ProjectLaunchHistoryEntry[],
  currentError: string | null = null,
): LaunchDiagnostic | null {
  const failedHistory = history.find((entry) => entry.state === "error" || (entry.exitCode != null && entry.exitCode !== 0));
  const stderr = [...logs].reverse().find((entry) => entry.stream === "stderr")?.line ?? null;
  const systemError = [...logs].reverse().find((entry) => entry.stream === "system" && /失败|error|exit\s+-?[1-9]/i.test(entry.line))?.line ?? null;
  const error = currentError ?? status?.error ?? failedHistory?.error ?? stderr ?? systemError;
  const exitCode = status?.exitCode ?? failedHistory?.exitCode ?? null;
  if (!error && (exitCode == null || exitCode === 0)) return null;

  if (/not found|不是内部或外部命令|无法将|command not found|ENOENT/i.test(error ?? "")) {
    return {
      title: "启动命令不可用",
      detail: error ?? `进程退出：${exitCode}`,
      steps: ["确认依赖已安装", "检查命令名称和 package script", "必要时重新选择启动指令"],
    };
  }
  if (/EADDRINUSE|address already in use|端口.*占用/i.test(error ?? "")) {
    return {
      title: "端口被占用",
      detail: error ?? `进程退出：${exitCode}`,
      steps: ["停止占用端口的进程", "修改项目启动端口", "重新运行启动命令"],
    };
  }
  return {
    title: "最近启动失败",
    detail: error ?? `进程退出：${exitCode}`,
    steps: ["查看终端输出中的最后几行", "修复依赖、端口或脚本错误", "重新运行启动命令"],
  };
}
