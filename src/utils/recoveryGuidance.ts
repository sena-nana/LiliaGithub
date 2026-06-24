export type RecoveryGuidanceTone = "info" | "warn" | "danger";

export interface RecoveryGuidance {
  title: string;
  tone: RecoveryGuidanceTone;
  summary: string;
  steps: string[];
}

const guidanceRules: Array<{
  match: RegExp;
  guidance: RecoveryGuidance;
}> = [
  {
    match: /冲突|conflict|merge failed|rebase/i,
    guidance: {
      title: "处理冲突后继续",
      tone: "danger",
      summary: "当前操作已停在冲突状态，需要先完成文件处理再继续 Git 操作。",
      steps: ["进入变更页的冲突处理", "逐文件选择分段或整文件采用一侧", "全部暂存后继续当前合并或 rebase"],
    },
  },
  {
    match: /未提交变更|local changes|dirty|would be overwritten|stash/i,
    guidance: {
      title: "保护本地修改",
      tone: "warn",
      summary: "同步被本地未提交内容阻止，先决定保留、暂存还是放弃这些修改。",
      steps: ["检查变更列表", "提交或 stash 需要保留的内容", "确认无误后重新执行 pull / sync"],
    },
  },
  {
    match: /upstream|上游/i,
    guidance: {
      title: "设置 upstream",
      tone: "warn",
      summary: "当前分支缺少可同步的远端跟踪分支。",
      steps: ["确认当前分支应推送到哪个 remote", "使用推送当前分支或设置 upstream", "再次执行同步"],
    },
  },
  {
    match: /认证|权限|permission|auth|403|401|credential|token/i,
    guidance: {
      title: "恢复 GitHub 权限",
      tone: "danger",
      summary: "GitHub 凭证或权限不足导致操作失败。",
      steps: ["重新绑定 GitHub", "检查仓库访问权限和 token scope", "必要时切换为系统 Git 推送"],
    },
  },
  {
    match: /origin remote|remote.*not|没有 origin/i,
    guidance: {
      title: "补齐 remote",
      tone: "warn",
      summary: "仓库缺少可用于同步的 origin remote。",
      steps: ["在终端或 Git 工具中添加 origin", "刷新仓库状态", "重新执行同步操作"],
    },
  },
];

export function recoveryGuidanceForMessage(message: string | null | undefined): RecoveryGuidance {
  const normalized = message?.trim() ?? "";
  for (const rule of guidanceRules) {
    if (rule.match.test(normalized)) return rule.guidance;
  }
  return {
    title: "查看错误并重试",
    tone: "info",
    summary: "当前错误无法自动归类，需要根据错误文本决定下一步。",
    steps: ["展开失败仓库查看完整错误", "刷新仓库状态", "确认问题已处理后重试操作"],
  };
}

export function conflictRecoveryGuidance(operation: string, hasFiles: boolean): RecoveryGuidance {
  if (!hasFiles) {
    return {
      title: "继续当前操作",
      tone: "info",
      summary: "冲突文件已处理，当前 Git 操作还需要继续或完成。",
      steps: [`点击继续 ${operation || "操作"}`, "确认仓库状态回到干净或可提交状态"],
    };
  }
  return recoveryGuidanceForMessage(`${operation} 冲突`);
}
