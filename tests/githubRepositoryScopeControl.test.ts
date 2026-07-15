import { fireEvent, render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import GitHubRepositoryScopeControl from "../src/components/github/GitHubRepositoryScopeControl.vue";
import {
  githubOrganizationAccessLimited,
  githubOrganizationAccessMessage,
  githubOrganizationAccessRecovery,
  githubRepositoryPermissionLabel,
} from "../src/utils/githubRepositoryScope";

const organizations = [
  { login: "alpha-org", kind: "organization", avatarUrl: null, membershipVisible: true, membershipComplete: true, repositoryAccessVisible: false, source: "membership" },
  { login: "beta-labs", kind: "organization", avatarUrl: null, membershipVisible: false, membershipComplete: true, repositoryAccessVisible: true, source: "repository_access" },
  { login: "gamma-team", kind: "organization", avatarUrl: null, membershipVisible: true, membershipComplete: true, repositoryAccessVisible: true, source: "both" },
] as const;

describe("GitHubRepositoryScopeControl", () => {
  it("在全部、个人与组织范围之间切换", async () => {
    const view = render(GitHubRepositoryScopeControl, {
      props: {
        modelValue: { kind: "all" },
        personalLogin: "sena-nana",
        organizations,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "sena-nana" }));
    expect(view.emitted("update:modelValue")?.[0]).toEqual([
      { kind: "personal", login: "sena-nana" },
    ]);

    await fireEvent.focus(screen.getByPlaceholderText("搜索组织"));
    await fireEvent.click(await screen.findByRole("option", { name: /alpha-org/ }));
    expect(view.emitted("update:modelValue")?.[1]).toEqual([
      { kind: "organization", login: "alpha-org" },
    ]);
  });

  it("可搜索大量组织并区分仅有仓库访问的 owner", async () => {
    render(GitHubRepositoryScopeControl, {
      props: {
        modelValue: { kind: "all" },
        personalLogin: "sena-nana",
        organizations,
      },
    });

    const search = screen.getByPlaceholderText("搜索组织");
    await fireEvent.focus(search);
    await fireEvent.update(search, "beta");

    expect(await screen.findByRole("option", { name: /beta-labs.*仓库访问/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /alpha-org/ })).not.toBeInTheDocument();
  });

  it("任一 owner 标记 membership 不完整时提示组织可见性受限", () => {
    expect(githubOrganizationAccessLimited(["repo", "read:org"], [
      {
        login: "sena-nana",
        kind: "user",
        avatarUrl: null,
        membershipVisible: true,
        membershipComplete: false,
        repositoryAccessVisible: true,
        source: "authenticated_user",
      },
    ])).toBe(true);
    expect(githubOrganizationAccessLimited(["repo", "read:org"], organizations)).toBe(false);
  });

  it("保留 SSO 限制原因和 GitHub 恢复入口", () => {
    const owners = [{
      ...organizations[0],
      membershipComplete: false,
      membershipRestriction: "sso_required" as const,
      membershipRecoveryUrl: "https://github.com/orgs/alpha-org/sso",
    }];

    expect(githubOrganizationAccessRecovery(owners)).toEqual({
      restriction: "sso_required",
      url: "https://github.com/orgs/alpha-org/sso",
    });
    expect(githubOrganizationAccessMessage(owners)).toContain("SSO");
  });

  it("权限标签只依据单仓库 permissions，不从组织成员身份推断", () => {
    expect(githubRepositoryPermissionLabel({ pull: true, push: false, admin: false })).toBe("只读");
    expect(githubRepositoryPermissionLabel({ pull: true, push: true, admin: false })).toBe("可推送");
    expect(githubRepositoryPermissionLabel({ pull: true, push: true, admin: true })).toBe("管理");
    expect(githubRepositoryPermissionLabel({ pull: false, push: false, admin: false })).toBe("无访问权限");
    expect(githubRepositoryPermissionLabel(undefined)).toBeNull();
  });
});
