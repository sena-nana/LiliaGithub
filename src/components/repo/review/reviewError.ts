function rawMessage(reason: unknown) {
  return String(reason).replace(/^Error:\s*/, "").trim();
}

export function codeReviewErrorMessage(reason: unknown, options: { draftPreserved?: boolean } = {}) {
  const message = rawMessage(reason) || "操作失败，请重试。";
  const preserved = options.draftPreserved ? "草稿已保留；" : "";
  if (/\b(?:401|403)\b|bad credentials|forbidden|scope|resource not accessible|无权|权限|授权/i.test(message)) {
    return `当前 GitHub 授权不允许此操作，${preserved}请重新绑定并授予仓库写入权限。`;
  }
  if (/network|fetch|timed?\s*out|timeout|connection|dns|offline|离线|网络|连接/i.test(message)) {
    return `暂时无法连接 GitHub，${preserved}请检查网络后重试。`;
  }
  if (/\b(?:404|409|422)\b|not found|unprocessable|outdated|不存在|已失效|已变化|commit.*(?:invalid|missing)|line.*invalid/i.test(message)) {
    return `Review 上下文已经变化或不存在，${preserved}请刷新后重试。`;
  }
  return message;
}
