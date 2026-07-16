import { describe, expect, it } from "vitest";
import { listAssignedWork, listPersonalNotifications } from "../src/services/personalHome";
import { setPersonalHomeFallbackForTests } from "../src/services/personalHome/fallback";
import { recordRecentLocalRepo, workspaceFallbackForTests } from "../src/services/workspace";
import { notificationTypeCounts, personalHomeRecentRepositories } from "../src/utils/personalHome";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

describe("个人首页数据", () => {
  it("独立加载分配工作和所有类型通知", async () => {
    setPersonalHomeFallbackForTests({
      assignedWork: [{
        repoFullName: "sena-nana/LiliaGithub",
        pullRequest: false,
        issue: {
          number: 21,
          title: "支持个人首页",
          state: "open",
          body: null,
          labels: [],
          assignees: ["sena-nana"],
          htmlUrl: "https://github.com/sena-nana/LiliaGithub/issues/21",
          updatedAt: "2026-07-16T08:00:00Z",
          createdAt: "2026-07-16T07:00:00Z",
        },
      }],
      notifications: [
        { id: "issue", repoFullName: "sena-nana/LiliaGithub", title: "Issue", reason: "assign", subjectType: "Issue", subjectUrl: null, latestCommentUrl: null, updatedAt: "2026-07-16T08:00:00Z", unread: true },
        { id: "discussion", repoFullName: "sena-nana/LiliaGithub", title: "Discussion", reason: "subscribed", subjectType: "Discussion", subjectUrl: null, latestCommentUrl: null, updatedAt: "2026-07-16T07:00:00Z", unread: true },
      ],
    });

    const [work, notifications] = await Promise.all([
      listAssignedWork(),
      listPersonalNotifications(),
    ]);

    expect(work).toHaveLength(1);
    expect(work[0]?.issue.assignees).toContain("sena-nana");
    expect(notificationTypeCounts(notifications)).toEqual([
      { label: "Discussion", count: 1 },
      { label: "Issue", count: 1 },
    ]);
  });

  it("按真实打开时间合并本地与远程仓库并排除隐藏仓库", () => {
    const settings = workspaceSettings(["hidden"]);
    settings.recentLocalRepos = [
      { repoId: "hidden", openedAt: 300 },
      { repoId: "local", openedAt: 200 },
    ];
    settings.remoteRepoShortcuts = [{
      fullName: "sena-nana/remote",
      name: "remote",
      private: false,
      archived: false,
      defaultBranch: "main",
      htmlUrl: "https://github.com/sena-nana/remote",
      cloneUrl: "https://github.com/sena-nana/remote.git",
      openedAt: 250,
    }];

    const recent = personalHomeRecentRepositories(settings, [repoSummary("local"), repoSummary("hidden")]);

    expect(recent.map((item) => item.key)).toEqual(["remote:sena-nana/remote", "local:local"]);
  });

  it("仓库成功访问记录会持久化去重", async () => {
    const fallback = await workspaceFallbackForTests();
    fallback.setFallbackRepoOverridesForTests({ LiliaGithub: repoSummary("LiliaGithub") });

    await recordRecentLocalRepo("LiliaGithub");
    const settings = await recordRecentLocalRepo("LiliaGithub");

    expect(settings.recentLocalRepos.filter((visit) => visit.repoId === "LiliaGithub")).toHaveLength(1);
  });
});
