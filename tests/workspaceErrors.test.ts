import { describe, expect, it } from "vitest";
import {
  isWorkspaceCommandCancelled,
  normalizeWorkspaceCommandError,
  workspaceErrorCategory,
  workspaceErrorCode,
} from "../src/services/workspace/errors";
import {
  isConfirmedMissingResource,
  isGitHubBindingExpiredError,
  isGitHubPermissionError,
} from "../src/utils/githubErrors";

describe("workspace command errors", () => {
  it("normalizes structured command errors without losing recovery metadata", () => {
    const error = normalizeWorkspaceCommandError({
      code: "github_rate_limited",
      category: "rate-limit",
      message: "GitHub 请求过于频繁。",
      retryable: true,
      httpStatus: 429,
      retryAfter: 30,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("GitHub 请求过于频繁。");
    expect(error.retryable).toBe(true);
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfter).toBe(30);
    expect(workspaceErrorCode(error)).toBe("github_rate_limited");
    expect(workspaceErrorCategory(error)).toBe("rate-limit");
  });

  it("keeps legacy string errors compatible while preferring typed categories", () => {
    expect(isGitHubBindingExpiredError({
      code: "github_authentication_required",
      category: "authentication",
      message: "需要重新绑定 GitHub。",
      retryable: false,
    })).toBe(true);
    expect(isGitHubPermissionError({
      code: "github_forbidden",
      category: "authorization",
      message: "权限不足。",
      retryable: false,
    })).toBe(true);
    expect(isConfirmedMissingResource({
      code: "github_repository_not_accessible",
      category: "not-found",
      message: "仓库不存在。",
      retryable: false,
    })).toBe(true);
    expect(isConfirmedMissingResource(new Error("network connection failed"))).toBe(false);
    expect(workspaceErrorCategory(new Error("HTTP 403 Forbidden"))).toBe("authorization");
    expect(workspaceErrorCategory(new Error("network timeout"))).toBe("network");
    expect(workspaceErrorCategory(new Error("HTTP 422 Unprocessable"))).toBe("validation");
    expect(workspaceErrorCategory(new Error("fatal: Authentication failed"))).toBe("authentication");
    expect(workspaceErrorCategory(new Error("当前 GitHub 绑定无权限"))).toBe("authorization");
    expect(workspaceErrorCategory(new Error("workspace_store_corrupt：配置内容损坏"))).toBe("validation");
    expect(workspaceErrorCategory(new Error("workspace_store_permission：无权读取配置"))).toBe("persistence");
    expect(isWorkspaceCommandCancelled(new Error("已取消选择仓库"))).toBe(true);
    expect(normalizeWorkspaceCommandError(new Error("已取消选择仓库"))).toMatchObject({
      category: "cancelled",
    });
  });
});
