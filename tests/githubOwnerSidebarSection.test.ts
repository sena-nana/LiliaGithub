import { fireEvent, render, screen, within } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import GitHubOwnerSidebarSection from "../src/components/sidebar/GitHubOwnerSidebarSection.vue";
import type { GitHubRepoOwner, GitHubRepoSummary } from "../src/services/workspace";
import { repoSummary } from "./fixtures/workspace";

function owner(login: string, kind: GitHubRepoOwner["kind"], source: GitHubRepoOwner["source"]): GitHubRepoOwner {
  return {
    login,
    kind,
    avatarUrl: null,
    membershipVisible: source !== "repository_access",
    membershipComplete: true,
    repositoryAccessVisible: source !== "membership",
    source,
  };
}

function remote(fullName: string, id: number, overrides: Partial<GitHubRepoSummary> = {}): GitHubRepoSummary {
  const [ownerLogin, name] = fullName.split("/");
  return {
    id,
    name,
    fullName,
    ownerLogin,
    private: false,
    disabled: false,
    archived: false,
    description: null,
    defaultBranch: "main",
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    ...overrides,
  };
}

describe("GitHubOwnerSidebarSection", () => {
  it("个人置顶、组织排序，并在 owner 内优先显示本地仓库", () => {
    localStorage.setItem("lilia-github.sidebar.githubOwners.collapsed.v1:sena-nana", "[]");
    const local = repoSummary("local-repo", { githubFullName: "alpha-org/local-repo" });
    render(GitHubOwnerSidebarSection, {
      props: {
        accountLogin: "sena-nana",
        owners: [
          owner("zeta-org", "organization", "repository_access"),
          owner("alpha-org", "organization", "membership"),
          owner("sena-nana", "user", "authenticated_user"),
        ],
        localRepos: [local],
        repositoriesByOwner: {
          "alpha-org": {
            items: [
              remote("alpha-org/local-repo", 1),
              remote("alpha-org/remote-repo", 2, {
                archived: true,
                permissions: { pull: true, push: false, admin: false },
              }),
            ],
            loading: false,
            loaded: true,
            error: null,
          },
        },
      },
    });

    const section = screen.getByRole("region", { name: "GitHub 账号与组织" });
    const personalOwner = within(section).getByRole("button", { name: /^sena-nana/ });
    const alphaOwner = within(section).getByRole("button", { name: /^alpha-org/ });
    const zetaOwner = within(section).getByRole("button", { name: /^zeta-org.*仓库访问/ });
    expect(personalOwner.compareDocumentPosition(alphaOwner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alphaOwner.compareDocumentPosition(zetaOwner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const localRow = within(section).getByRole("button", { name: /local-repo.*本地/ });
    const remoteRow = within(section).getByRole("button", { name: /remote-repo/ });
    expect(localRow.compareDocumentPosition(remoteRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByText("仓库访问")).toBeInTheDocument();
    expect(within(section).getByText("已归档")).toBeInTheDocument();
    expect(within(section).getByText("只读")).toBeInTheDocument();
    expect(alphaOwner).toHaveAccessibleName(/alpha-org.*1\/2/);
  });

  it("默认折叠 owner，并仅在用户展开时按需加载和持久化状态", async () => {
    const zeta = owner("zeta-org", "organization", "membership");
    const props = {
      accountLogin: "sena-nana",
      owners: [zeta],
      localRepos: [],
      repositoriesByOwner: {},
    };
    const view = render(GitHubOwnerSidebarSection, { props });

    expect(screen.getByRole("button", { name: /zeta-org.*0\/…/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "展开 zeta-org" }));
    expect(view.emitted("loadOwner")?.[0]).toEqual([zeta]);
    expect(screen.getByText("正在加载远程仓库…")).toBeInTheDocument();
    expect(localStorage.getItem("lilia-github.sidebar.githubOwners.collapsed.v1:sena-nana")).not.toContain("zeta-org");

    await fireEvent.click(screen.getByRole("button", { name: "折叠 zeta-org" }));
    expect(localStorage.getItem("lilia-github.sidebar.githubOwners.collapsed.v1:sena-nana")).toContain("zeta-org");
  });

  it("没有可见组织时仍展示全局组织权限受限提示", async () => {
    const incompleteUser = {
      ...owner("sena-nana", "user", "authenticated_user"),
      membershipComplete: false,
    };
    const view = render(GitHubOwnerSidebarSection, {
      props: {
        accountLogin: "sena-nana",
        owners: [incompleteUser],
        localRepos: [],
        repositoriesByOwner: {},
        organizationAccessLimited: true,
      },
    });

    expect(screen.getByText("组织信息可能不完整，现有仓库仍可继续使用。")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "补充组织权限" }));
    expect(view.emitted("authorize")).toEqual([[null]]);
  });
});
