import { describe, expect, it } from "vitest";
import { isConfirmedMissingResource } from "../src/utils/githubErrors";

describe("GitHub resource error classification", () => {
  it("只把确认缺失与可重试访问错误区分开", () => {
    expect(isConfirmedMissingResource("github_repository_not_accessible：读取失败：HTTP 404 Not Found")).toBe(true);
    expect(isConfirmedMissingResource("未找到 Release v1.0.0")).toBe(true);
    expect(isConfirmedMissingResource("github_forbidden：读取失败：HTTP 403 Forbidden")).toBe(false);
    expect(isConfirmedMissingResource("github_rate_limited：读取失败：HTTP 403 API rate limit exceeded")).toBe(false);
    expect(isConfirmedMissingResource("读取失败：GitHub API 连接失败：host not found")).toBe(false);
    expect(isConfirmedMissingResource("未找到 GitHub 绑定凭证")).toBe(false);
  });
});
