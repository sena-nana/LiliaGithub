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
      title: "同步冲突待处理",
      tone: "danger",
      summary: "pull 或合并已停在冲突状态，需要先完成文件处理。",
      steps: ["进入变更页处理冲突文件", "逐文件选择分段或整文件采用一侧", "全部暂存后继续当前合并或 rebase"],
    },
  },
  {
    match: /未提交变更|local changes|dirty|would be overwritten|stash/i,
    guidance: {
      title: "未提交变更阻塞同步",
      tone: "warn",
      summary: "pull 或自动同步会覆盖本地未提交内容，因此已被阻止。",
      steps: ["检查变更列表", "提交、stash 或放弃需要处理的内容", "确认工作区干净后重新同步"],
    },
  },
  {
    match: /upstream|上游/i,
    guidance: {
      title: "缺少 upstream",
      tone: "warn",
      summary: "当前分支缺少可同步的远端跟踪分支。",
      steps: ["确认当前分支应推送到哪个 remote", "使用推送当前分支或设置 upstream", "再次执行同步"],
    },
  },
  {
    match: /认证|权限|permission|auth|403|401|credential|token/i,
    guidance: {
      title: "认证或权限失效",
      tone: "danger",
      summary: "GitHub 凭证失效、权限不足或当前账号无法访问该仓库。",
      steps: ["重新绑定 GitHub", "检查仓库访问权限和 token scope", "处理权限后重新执行同步"],
    },
  },
  {
    match: /repository not found|仓库不存在|无法访问 GitHub 仓库/i,
    guidance: {
      title: "认证或权限失效",
      tone: "danger",
      summary: "当前账号无法访问远端仓库，或远端仓库已不存在。",
      steps: ["确认远端仓库地址", "重新绑定有访问权限的 GitHub 账号", "刷新仓库状态后重新同步"],
    },
  },
  {
    match: /origin remote|remote ['"]?origin['"]? not|没有 origin|no such remote/i,
    guidance: {
      title: "缺少 origin remote",
      tone: "warn",
      summary: "仓库缺少可用于同步的 origin remote。",
      steps: ["在终端或 Git 工具中添加 origin", "刷新仓库状态", "重新执行同步操作"],
    },
  },
  {
    match: /Not possible to fast-forward|Diverging branches|无法快进/i,
    guidance: {
      title: "需要合并上游",
      tone: "warn",
      summary: "本地与远端已分叉，快进拉取不可用，需要先合并或变基上游。",
      steps: ["改用合并拉取或抓取后变基", "如出现冲突，先在冲突对话框处理文件", "合并完成后再推送本地提交"],
    },
  },
  {
    match: /rejected|failed to push some refs|non-fast-forward|fetch first|pre-receive hook declined|protected branch|remote rejected|GH006|GH013/i,
    guidance: {
      title: "远端拒绝同步",
      tone: "danger",
      summary: "远端拒绝了 push，通常是分支落后、分支保护或服务端规则阻止写入。",
      steps: ["先拉取并合并远端更新", "检查分支保护和必需检查", "满足远端规则后重新推送"],
    },
  },
];

export function isFastForwardPullFailure(message: string | null | undefined): boolean {
  return /Not possible to fast-forward|Diverging branches|无法快进/i.test(message?.trim() ?? "");
}

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
