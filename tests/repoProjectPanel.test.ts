import { fireEvent, render, waitFor, within } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import RepoProjectPanel from "../src/components/repo/RepoProjectPanel.vue";
import {
  closeContextMenu,
  installContextMenu,
  selectContextMenuItem,
  useContextMenu,
} from "@lilia/ui/composables/useContextMenu";
import { startAuthFlow } from "../src/composables/workspace/auth";
import { state } from "../src/composables/workspace/state";
import { liliaContextMenuPlugin } from "./helpers/liliaContextMenu";
import {
  createGitHubPullRequest,
  createGitHubIssue,
  createGitHubRelease,
  attachGitHubWorkflowArtifactAsset,
  deleteGitHubBranch,
  deleteGitHubRepo,
  deleteGitHubRelease,
  deleteGitHubReleaseAsset,
  getGitHubIssueDiscussion,
  getGitHubIssueFilterMetadata,
  getGitHubBranchProtection,
  getGitHubRepoFilePreview,
  getGitHubPullRequestDiscussion,
  getGitHubRepoManagement,
  getGitHubRepoRuleset,
  getGitHubRepoSettingsSection,
  getRepoCommitDetail,
  getRepoFilePreview,
  getRepoStorageStats,
  getGitHubWorkflowArtifactFilePreview,
  getGitHubWorkflowJobLog,
  getGitHubWorkflowRunDetail,
  listGitHubWorkflowArtifactFiles,
  listGitHubPullRequestChecks,
  listGitHubPullRequests,
  listGitHubIssues,
  listGitHubIssueAssignees,
  listGitHubIssueLabels,
  listGitHubRepoFiles,
  listGitHubRepoRulesets,
  listGitHubBranches,
  listGitHubWorkflowRuns,
  listGitHubReleases,
  listRepoFiles,
  mergeGitHubPullRequest,
  openPathTarget,
  openUrl,
  pickFiles,
  rerunFailedGitHubWorkflowRun,
  rerunGitHubWorkflowJob,
  updateGitHubRelease,
  updateGitHubBranchProtection,
  updateGitHubRepoActionsPermissions,
  updateGitHubRepoRuleset,
  updateGitHubRepoWorkflowPermissions,
  updateGitHubRepoSettings,
  uploadGitHubReleaseAsset,
} from "../src/services/workspace/client";
import type {
  CommitDetail,
  CommitSummary,
  GitHubIssue,
  GitHubIssueDiscussion,
  GitHubPullRequest,
  GitHubPullRequestCheck,
  GitHubPullRequestDiscussion,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoManagement,
  GitHubRepoSettingsSection,
  GitHubRepoSettingsSectionKey,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetail,
  ProjectLaunchConfig,
  ProjectLaunchLog,
  RepoFilePreview,
  RepoFileTreeEntry,
} from "../src/services/workspace/types";
import { resolveRepoContext } from "../src/utils/repoContext";
import { repoSummary, workspaceSettings } from "./fixtures/workspace";

const githubSettings: GitHubRepoManagement = {
  fullName: "sena-nana/remote-repo",
  name: "remote-repo",
  description: "Remote repository tools",
  homepage: "https://example.com/remote",
  topics: ["vue", "tauri"],
  private: false,
  defaultBranch: "main",
  hasIssues: true,
  hasWiki: false,
  hasProjects: true,
  hasDiscussions: false,
  allowMergeCommit: true,
  allowSquashMerge: true,
  allowRebaseMerge: true,
  allowAutoMerge: false,
  deleteBranchOnMerge: false,
  allowForking: true,
  webCommitSignoffRequired: false,
  stargazersCount: 128,
  watchersCount: 9,
  forksCount: 14,
  htmlUrl: "https://github.com/sena-nana/remote-repo",
  license: {
    key: "bsd-3-clause",
    name: "BSD 3-Clause License",
    spdxId: "BSD-3-Clause",
    url: "https://api.github.com/licenses/bsd-3-clause",
  },
};

const localRootFiles: RepoFileTreeEntry[] = [repoFile("README.md")];
const localReadmePreview = filePreview("README.md", "# Project README");
const localOpenTargetCases = [
  ["在终端打开", "terminal"],
  ["用 VSCode 打开", "vscode"],
  ["用 LiliaCode 打开", "liliacode"],
] as const;

const githubIssues: GitHubIssue[] = [{
  number: 12,
  title: "修复懒加载",
  state: "open",
  body: null,
  labels: ["bug"],
  assignees: ["sena"],
  author: "sena",
  milestone: { number: 1, title: "v1" },
  comments: 3,
  projectItems: [{ id: "PVT_kwDOIssue", title: "Roadmap" }],
  htmlUrl: "https://github.com/sena-nana/remote-repo/issues/12",
  updatedAt: "2026-06-18T08:00:00Z",
  createdAt: "2026-06-18T08:00:00Z",
}];

const closedGitHubIssues: GitHubIssue[] = [{
  ...githubIssues[0],
  number: 34,
  title: "已关闭问题",
  state: "closed",
  htmlUrl: "https://github.com/sena-nana/remote-repo/issues/34",
}];

const githubWorkflowRuns: GitHubWorkflowRun[] = [{
  id: 1310,
  name: "CI",
  displayTitle: "release pipeline",
  status: "completed",
  conclusion: "success",
  branch: "main",
  event: "workflow_dispatch",
  htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310",
  createdAt: "2026-06-18T08:00:00Z",
  updatedAt: "2026-06-18T08:00:00Z",
  headSha: "abc123",
  workflowId: 99,
}];

const githubWorkflowRunDetail: GitHubWorkflowRunDetail = {
  run: {
    ...githubWorkflowRuns[0],
    actor: "sena",
    runNumber: 23,
    runAttempt: 1,
    runStartedAt: "2026-06-18T08:00:00Z",
  },
  jobs: [
    {
      id: 13101,
      name: "lint",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:00:00Z",
      completedAt: "2026-06-18T08:01:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13101",
      runnerName: "GitHub Actions",
      steps: [{
        name: "Run lint",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T08:01:00Z",
      }],
    },
    {
      id: 13102,
      name: "build",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:00:00Z",
      completedAt: "2026-06-18T08:02:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13102",
      runnerName: "GitHub Actions",
      steps: [{
        name: "Build app",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T08:02:00Z",
      }],
    },
    {
      id: 13103,
      name: "test",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:02:00Z",
      completedAt: "2026-06-18T08:04:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13103",
      runnerName: "GitHub Actions",
      steps: [
        {
          name: "Set up job",
          status: "completed",
          conclusion: "success",
          number: 1,
          startedAt: "2026-06-18T08:02:00Z",
          completedAt: "2026-06-18T08:02:10Z",
        },
        {
          name: "Run tests",
          status: "completed",
          conclusion: "success",
          number: 2,
          startedAt: "2026-06-18T08:02:10Z",
          completedAt: "2026-06-18T08:04:00Z",
        },
      ],
    },
    {
      id: 13104,
      name: "package",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-06-18T08:04:00Z",
      completedAt: "2026-06-18T08:05:00Z",
      htmlUrl: "https://github.com/sena-nana/remote-repo/actions/runs/1310/job/13104",
      runnerName: "GitHub Actions",
      steps: [{
        name: "Package dist",
        status: "completed",
        conclusion: "success",
        number: 1,
        startedAt: "2026-06-18T08:04:00Z",
        completedAt: "2026-06-18T08:05:00Z",
      }],
    },
  ],
  artifacts: [{
    id: 131001,
    name: "dist",
    sizeInBytes: 1280,
    expired: false,
    createdAt: "2026-06-18T08:02:00Z",
    expiresAt: "2026-07-18T08:02:00Z",
  }],
  workflow: {
    id: 99,
    path: ".github/workflows/ci.yml",
    refName: "abc123",
    content: [
      "name: CI",
      "jobs:",
      "  lint:",
      "    name: lint",
      "    runs-on: ubuntu-latest",
      "  build:",
      "    name: build",
      "    runs-on: ubuntu-latest",
      "  test:",
      "    name: test",
      "    needs: [lint, build]",
      "    runs-on: ubuntu-latest",
      "  package:",
      "    name: package",
      "    needs: test",
      "    runs-on: ubuntu-latest",
    ].join("\n"),
  },
};

function failedWorkflowRunDetail(): GitHubWorkflowRunDetail {
  const now = new Date().toISOString();
  return {
    ...githubWorkflowRunDetail,
    run: {
      ...githubWorkflowRunDetail.run,
      status: "completed",
      conclusion: "failure",
      createdAt: now,
      updatedAt: now,
    },
    jobs: githubWorkflowRunDetail.jobs.map((job) => job.id === 13103
      ? {
        ...job,
        conclusion: "failure",
        steps: job.steps.map((step) => step.number === 2 ? { ...step, conclusion: "failure" } : step),
      }
      : job),
  };
}

const githubPullRequests: GitHubPullRequest[] = [{
  number: 52,
  title: "接入 Pull Request 工作流",
  state: "open",
  draft: false,
  body: "## Summary\n\n接入 PR 工作流。",
  labels: ["bug"],
  assignees: ["sena"],
  milestone: { number: 1, title: "v1", state: "open" },
  comments: 2,
  projectItems: [{ id: "PVT_kwDOIssue", title: "Roadmap" }],
  reviewers: [
    { login: "mika", kind: "user", state: "requested" },
    { login: "core", kind: "team", state: "APPROVED" },
  ],
  developmentItems: [
    {
      id: "issue:sena-nana/remote-repo:12",
      kind: "issue",
      label: "Issue #12 修复懒加载",
      url: "https://github.com/sena-nana/remote-repo/issues/12",
      number: 12,
      state: "open",
      repositoryFullName: "sena-nana/remote-repo",
    },
    {
      id: "commit:sena-nana/remote-repo:abcdef1234567890",
      kind: "commit",
      label: "abcdef1 接入 PR 详情侧栏",
      url: "https://github.com/sena-nana/remote-repo/commit/abcdef1234567890",
      sha: "abcdef1234567890",
      repositoryFullName: "sena-nana/remote-repo",
    },
  ],
  commitCount: 2,
  htmlUrl: "https://github.com/sena-nana/remote-repo/pull/52",
  updatedAt: "2026-06-18T08:00:00Z",
  createdAt: "2026-06-18T08:00:00Z",
  author: "sena",
  baseBranch: "main",
  headBranch: "feature/pr-flow",
  merged: false,
  mergeable: true,
  mergeableState: "clean",
}];

const githubPullRequestChecks: GitHubPullRequestCheck[] = [{
  id: 1,
  name: "ci / build",
  status: "completed",
  conclusion: "success",
  detailsUrl: null,
  htmlUrl: null,
  startedAt: "2026-06-18T08:00:00Z",
  completedAt: "2026-06-18T08:05:00Z",
}];

function releaseAsset(overrides: Partial<GitHubReleaseAsset> = {}): GitHubReleaseAsset {
  return {
    id: 9001,
    name: "lilia-windows.zip",
    label: "Windows",
    contentType: "application/zip",
    size: 2_048,
    downloadCount: 7,
    state: "uploaded",
    browserDownloadUrl: "https://github.com/sena-nana/remote-repo/releases/download/v1.0.0/lilia-windows.zip",
    createdAt: "2026-06-18T08:10:00Z",
    updatedAt: "2026-06-18T08:10:00Z",
    ...overrides,
  };
}

const githubReleases: GitHubRelease[] = [
  {
    id: 8001,
    tagName: "v1.0.0",
    targetCommitish: "main",
    name: "Lilia v1.0.0",
    body: [
      "## Summary",
      "",
      "正式发布。",
      "",
      "- 支持 release 时间线布局",
      "- 支持资产紧凑列表",
      "- 支持右侧筛选",
      "- 支持 Markdown 渲染",
      "- 优化提交者和时间显示",
      "- 优化长内容折叠",
    ].join("\n"),
    draft: false,
    prerelease: false,
    makeLatest: "true",
    author: "sena",
    htmlUrl: "https://github.com/sena-nana/remote-repo/releases/tag/v1.0.0",
    uploadUrl: "https://uploads.github.com/repos/sena-nana/remote-repo/releases/8001/assets{?name,label}",
    tarballUrl: "https://api.github.com/repos/sena-nana/remote-repo/tarball/v1.0.0",
    zipballUrl: "https://api.github.com/repos/sena-nana/remote-repo/zipball/v1.0.0",
    createdAt: "2026-06-18T08:00:00Z",
    publishedAt: "2026-06-18T08:05:00Z",
    assets: [
      releaseAsset(),
      releaseAsset({
        id: 9002,
        name: "lilia-macos.dmg",
        label: "macOS",
        size: 4_096,
        downloadCount: 3,
        browserDownloadUrl: "https://github.com/sena-nana/remote-repo/releases/download/v1.0.0/lilia-macos.dmg",
      }),
      releaseAsset({
        id: 9003,
        name: "lilia-linux.AppImage",
        label: "Linux",
        size: 8_192,
        downloadCount: 1,
        browserDownloadUrl: "https://github.com/sena-nana/remote-repo/releases/download/v1.0.0/lilia-linux.AppImage",
      }),
    ],
  },
  {
    id: 8002,
    tagName: "v1.1.0-beta.1",
    targetCommitish: "develop",
    name: "Lilia v1.1 beta",
    body: null,
    draft: false,
    prerelease: true,
    makeLatest: "false",
    author: "mika",
    htmlUrl: "https://github.com/sena-nana/remote-repo/releases/tag/v1.1.0-beta.1",
    uploadUrl: "https://uploads.github.com/repos/sena-nana/remote-repo/releases/8002/assets{?name,label}",
    tarballUrl: null,
    zipballUrl: null,
    createdAt: "2026-06-19T08:00:00Z",
    publishedAt: "2026-06-19T08:05:00Z",
    assets: [],
  },
];

function issueDiscussion(issue: GitHubIssue): GitHubIssueDiscussion {
  return {
    issue,
    timeline: [{
      id: `issue-${issue.number}-body`,
      kind: "body",
      actor: issue.author,
      body: issue.body,
      url: issue.htmlUrl,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }],
  };
}

function pullRequestDiscussion(pullRequest: GitHubPullRequest): GitHubPullRequestDiscussion {
  return {
    pullRequest,
    timeline: [{
      id: `pull-${pullRequest.number}-body`,
      kind: "body",
      actor: pullRequest.author,
      body: pullRequest.body,
      url: pullRequest.htmlUrl,
      createdAt: pullRequest.createdAt,
      updatedAt: pullRequest.updatedAt,
    }],
  };
}

const remoteCommit: CommitSummary = {
  hash: "fedcba9876543210",
  shortHash: "fedcba9",
  author: "Sena",
  authorEmail: "sena@example.com",
  timestamp: 1_785_010_000,
  subject: "远程历史提交",
  parents: ["1234567890abcdef"],
  refs: ["main"],
};

const remoteCommitDetail: CommitDetail = {
  ...remoteCommit,
  committer: "Sena",
  committerEmail: "sena@example.com",
  body: "远程提交详情。",
  files: [{
    path: "src/remote.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "diff --git a/src/remote.ts b/src/remote.ts\n@@ -1 +1,2 @@\n export const remote = true;\n+export const history = true;",
    hunks: [{
      header: "@@ -1 +1,2 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: "context", content: "export const remote = true;", oldLine: 1, newLine: 1 },
        { kind: "added", content: "export const history = true;", oldLine: null, newLine: 2 },
      ],
    }],
  }],
};

function repoFile(path: string): RepoFileTreeEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    kind: "file",
    hasChildren: false,
  };
}

function repoDir(path: string): RepoFileTreeEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    kind: "dir",
    hasChildren: true,
  };
}

function filePreview(path: string, content: string, overrides: Partial<RepoFilePreview> = {}): RepoFilePreview {
  return {
    path,
    name: path.split("/").pop() ?? path,
    previewKind: path.endsWith(".md") ? "markdown" : "text",
    content,
    images: {},
    size: content.length,
    mimeType: "text/plain",
    truncated: false,
    ...overrides,
  };
}

function settingsSection(section: GitHubRepoSettingsSectionKey): GitHubRepoSettingsSection {
  const item = (key: string, label: string, value: unknown) => ({
    key,
    label,
    method: "GET",
    path: "",
    value,
    error: null,
    mutable: true,
    dangerous: false,
  });
  const sections: Partial<Record<GitHubRepoSettingsSectionKey, GitHubRepoSettingsSection>> = {
    security: {
      key: "security",
      title: "Security",
      fetchedAt: 1,
      items: [
        item("repository", "仓库安全与分析", {
          security_and_analysis: {
            advanced_security: { status: "enabled" },
            secret_scanning: { status: "enabled" },
          },
        }),
        item("vulnerabilityAlerts", "漏洞警报", { status: "enabled" }),
        item("dependabotSecurityUpdates", "Dependabot 安全更新", { status: "enabled" }),
      ],
    },
    branches: {
      key: "branches",
      title: "Branches",
      fetchedAt: 1,
      items: [item("branches", "分支", [{ name: "main", protected: true }, { name: "feature/settings", protected: false }])],
    },
    actions: {
      key: "actions",
      title: "Actions",
      fetchedAt: 1,
      items: [
        item("permissions", "Actions permissions", { enabled: true, allowed_actions: "all" }),
        item("workflowPermissions", "工作流默认权限", {
          default_workflow_permissions: "read",
          can_approve_pull_request_reviews: false,
        }),
        item("workflows", "工作流", { total_count: 2, workflows: [] }),
      ],
    },
    environments: {
      key: "environments",
      title: "Environments",
      fetchedAt: 1,
      items: [item("environments", "环境", { total_count: 1, environments: [{ id: 1, name: "production" }] })],
    },
    webhooks: {
      key: "webhooks",
      title: "Webhooks",
      fetchedAt: 1,
      items: [item("webhooks", "Webhooks", [{ id: 1, name: "Deploy", active: true, events: ["push"] }])],
    },
    collaborators: {
      key: "collaborators",
      title: "协作者",
      fetchedAt: 1,
      items: [
        item("collaborators", "协作者", [{ login: "sena" }]),
        item("teams", "仓库团队", [{ name: "maintainers" }]),
      ],
    },
    deployKeys: {
      key: "deployKeys",
      title: "部署密钥",
      fetchedAt: 1,
      items: [item("deployKeys", "部署密钥", [{ id: 1, title: "CI" }])],
    },
    githubApps: {
      key: "githubApps",
      title: "GitHub Apps",
      fetchedAt: 1,
      items: [item("installations", "仓库 GitHub App 安装", [{ id: 1, name: "Lilia Bot" }])],
    },
  };
  return sections[section] ?? { key: section, title: section, fetchedAt: 1, items: [] };
}

async function expectTreeOpenTarget(row: HTMLElement, label: string, target: string, path: string) {
  const contextMenu = useContextMenu();
  closeContextMenu();
  await fireEvent.contextMenu(row);
  const item = contextMenu.state.items.find((menuItem) => menuItem.label === label);
  expect(item).toBeTruthy();
  await selectContextMenuItem(item!);
  await waitFor(() => {
    expect(openPathTarget).toHaveBeenLastCalledWith(path, target);
  });
}

const { getRepoCommitDetailMock } = vi.hoisted(() => ({
  getRepoCommitDetailMock: vi.fn(),
}));

vi.mock("../src/services/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/workspace")>(),
  getRepoCommitDetail: getRepoCommitDetailMock,
}));

vi.mock("../src/services/workspace/client", () => ({
  createGitHubPullRequest: vi.fn(),
  createGitHubIssue: vi.fn(),
  createGitHubRelease: vi.fn(),
  attachGitHubWorkflowArtifactAsset: vi.fn(),
  deleteGitHubBranch: vi.fn(),
  deleteGitHubRepo: vi.fn(),
  deleteGitHubRelease: vi.fn(),
  deleteGitHubReleaseAsset: vi.fn(),
  getGitHubIssueDiscussion: vi.fn(),
  getGitHubBranchProtection: vi.fn(),
  getGitHubRepoFilePreview: vi.fn(),
  getGitHubIssueFilterMetadata: vi.fn(),
  getGitHubPullRequestDiscussion: vi.fn(),
  getRepoCommitDetail: getRepoCommitDetailMock,
  getGitHubRepoManagement: vi.fn(),
  getGitHubRepoRuleset: vi.fn(),
  getRepoFilePreview: vi.fn(),
  getRepoStorageStats: vi.fn(),
  listGitHubPullRequestChecks: vi.fn(),
  listGitHubPullRequests: vi.fn(),
  listGitHubIssues: vi.fn(),
  listGitHubIssueAssignees: vi.fn(),
  listGitHubIssueLabels: vi.fn(),
  listGitHubRepoFiles: vi.fn(),
  listGitHubRepoRulesets: vi.fn(),
  listGitHubWorkflowRuns: vi.fn(),
  listGitHubReleases: vi.fn(),
  getGitHubWorkflowRunDetail: vi.fn(),
  getGitHubWorkflowJobLog: vi.fn(),
  rerunFailedGitHubWorkflowRun: vi.fn(),
  rerunGitHubWorkflowJob: vi.fn(),
  listGitHubWorkflowArtifactFiles: vi.fn(),
  getGitHubWorkflowArtifactFilePreview: vi.fn(),
  isGitHubBindingExpiredError: (err: unknown) => {
    const message = String(err);
    return message.includes("GitHub 绑定已失效") ||
      message.includes("HTTP 401") ||
      message.includes("HTTP 403") ||
      message.toLowerCase().includes("bad credentials");
  },
  mergeGitHubPullRequest: vi.fn(),
  pickFiles: vi.fn(),
  listRepoFiles: vi.fn(async () => []),
  listGitHubBranches: vi.fn(async () => [{ name: "main", remote: true, current: false }]),
  getGitHubRepoSettingsSection: vi.fn(),
  openPath: vi.fn(),
  openPathTarget: vi.fn(),
  openUrl: vi.fn(),
  updateGitHubIssue: vi.fn(),
  updateGitHubRelease: vi.fn(),
  updateGitHubBranchProtection: vi.fn(),
  updateGitHubRepoActionsPermissions: vi.fn(),
  updateGitHubRepoRuleset: vi.fn(),
  updateGitHubRepoWorkflowPermissions: vi.fn(),
  updateGitHubRepoSettings: vi.fn(async (_repoFullName: string, request: Partial<GitHubRepoManagement>) => ({
    ...githubSettings,
    ...request,
    description: request.description ?? githubSettings.description,
    homepage: request.homepage ?? githubSettings.homepage,
    topics: request.topics ? [...request.topics] : [...githubSettings.topics],
  })),
  uploadGitHubReleaseAsset: vi.fn(),
}));

vi.mock("../src/composables/workspace/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/composables/workspace/auth")>();
  return {
    ...actual,
    startAuthFlow: vi.fn(),
  };
});

const launchConfig: ProjectLaunchConfig = {
  command: "yarn dev",
  cwd: null,
  source: "inferred",
  updatedAt: null,
};

async function workspaceFallbackForTests() {
  const client = await vi.importActual<typeof import("../src/services/workspace/client")>(
    "../src/services/workspace/client",
  );
  return client.workspaceFallbackForTests();
}

type RepoProjectPanelProps = InstanceType<typeof RepoProjectPanel>["$props"];
type RenderProjectPanelProps = Omit<RepoProjectPanelProps, "repoContext"> & {
  repoContext?: RepoProjectPanelProps["repoContext"];
};
type RepoProjectPanelRefreshHandle = { refreshCurrentPage: () => Promise<void> };

async function renderProjectPanel(
  props: Partial<RepoProjectPanelProps> = {},
  routePath = "/repos/local-repo",
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/repos/:repoId(.*)", component: { template: "<div />" } }],
  });
  await router.push(routePath);
  await router.isReady();

  const panelProps = {
    repoId: "local-repo",
    repoFullName: null,
    repoPath: "C:\\Files\\workspace\\local-repo",
    repoSummary: null,
    launchConfig,
    launchLogs: [],
    launchTerminalVisible: false,
    actionRunning: false,
    launchRunning: false,
    activeGitTab: "repo",
    canLoadFiles: true,
    changes: [],
    discardingChangePaths: [],
    previewChange: null,
    commitMessage: "",
    hasConflicts: false,
    canCommit: false,
    needsPublish: false,
    statusCommits: [],
    commitMetaTitle: () => "",
    projectTab: "readme",
    projectIssueNumber: null,
    projectPullRequestNumber: null,
    projectRunId: null,
    projectJobId: null,
    ...props,
  } satisfies RenderProjectPanelProps;
  const repoSummary = panelProps.repoSummary ?? state.repos.find((repo) => repo.id === panelProps.repoId) ?? null;
  const repoContext = panelProps.repoContext ?? resolveRepoContext({
    repoId: panelProps.repoId,
    repoSummary,
    githubFullName: panelProps.repoFullName ?? null,
    localPath: panelProps.repoPath ?? null,
    settings: state.settings,
    githubAuthorized: true,
  });

  const panel = ref<RepoProjectPanelRefreshHandle | null>(null);
  const TestHost = defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h(RepoProjectPanel, { ...attrs, ref: panel });
    },
  });
  const view = render(TestHost as typeof RepoProjectPanel, {
    props: {
      ...panelProps,
      repoContext,
    },
    global: {
      plugins: [router, liliaContextMenuPlugin],
    },
  });
  return {
    ...view,
    router,
    refreshCurrentPage: async () => {
      await panel.value?.refreshCurrentPage();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe("RepoProjectPanel", () => {
  beforeEach(async () => {
    closeContextMenu();
    installContextMenu();
    vi.clearAllMocks();
    vi.mocked(createGitHubPullRequest).mockReset();
    vi.mocked(createGitHubIssue).mockReset();
    vi.mocked(createGitHubRelease).mockReset();
    vi.mocked(attachGitHubWorkflowArtifactAsset).mockReset();
    vi.mocked(deleteGitHubBranch).mockReset();
    vi.mocked(deleteGitHubRepo).mockReset();
    vi.mocked(deleteGitHubRelease).mockReset();
    vi.mocked(deleteGitHubReleaseAsset).mockReset();
    vi.mocked(getGitHubIssueDiscussion).mockReset();
    vi.mocked(getGitHubBranchProtection).mockReset();
    vi.mocked(getGitHubPullRequestDiscussion).mockReset();
    vi.mocked(getGitHubRepoFilePreview).mockReset();
    vi.mocked(getRepoCommitDetail).mockReset();
    vi.mocked(getRepoFilePreview).mockReset();
    vi.mocked(getRepoStorageStats).mockReset();
    vi.mocked(getGitHubIssueFilterMetadata).mockReset();
    vi.mocked(getGitHubRepoManagement).mockReset();
    vi.mocked(getGitHubRepoRuleset).mockReset();
    vi.mocked(getGitHubRepoSettingsSection).mockReset();
    vi.mocked(listGitHubIssueAssignees).mockReset();
    vi.mocked(listGitHubIssueLabels).mockReset();
    vi.mocked(listGitHubRepoFiles).mockReset();
    vi.mocked(listGitHubRepoRulesets).mockReset();
    vi.mocked(listGitHubBranches).mockReset();
    vi.mocked(listGitHubReleases).mockReset();
    vi.mocked(listRepoFiles).mockReset();
    vi.mocked(openPathTarget).mockReset();
    vi.mocked(pickFiles).mockReset();
    vi.mocked(updateGitHubRelease).mockReset();
    vi.mocked(updateGitHubBranchProtection).mockReset();
    vi.mocked(updateGitHubRepoActionsPermissions).mockReset();
    vi.mocked(updateGitHubRepoRuleset).mockReset();
    vi.mocked(updateGitHubRepoWorkflowPermissions).mockReset();
    vi.mocked(updateGitHubRepoSettings).mockReset();
    vi.mocked(uploadGitHubReleaseAsset).mockReset();
    vi.mocked(createGitHubIssue).mockImplementation(async (_repoFullName, request) => ({
      number: 99,
      title: request.title,
      state: "open",
      body: request.body ?? null,
      labels: [...request.labels],
      assignees: [...request.assignees],
      author: "sena",
      milestone: null,
      comments: 0,
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/issues/99",
      updatedAt: "2026-06-18T09:00:00Z",
      createdAt: "2026-06-18T09:00:00Z",
    }));
    vi.mocked(createGitHubPullRequest).mockImplementation(async (_repoFullName, request) => ({
      number: 101,
      title: request.title,
      state: "open",
      draft: request.draft ?? false,
      body: request.body ?? null,
      labels: [],
      assignees: [],
      milestone: null,
      comments: 0,
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/101",
      updatedAt: "2026-06-18T09:00:00Z",
      createdAt: "2026-06-18T09:00:00Z",
      author: "sena",
      baseBranch: request.base,
      headBranch: request.head,
      merged: false,
      mergeable: null,
      mergeableState: null,
    }));
    vi.mocked(createGitHubRelease).mockImplementation(async (_repoFullName, request) => ({
      ...githubReleases[0],
      id: 8100,
      tagName: request.tagName,
      targetCommitish: request.targetCommitish ?? "main",
      name: request.name,
      body: request.body,
      draft: request.draft ?? false,
      prerelease: request.prerelease ?? false,
      makeLatest: "false",
      assets: [],
    }));
    vi.mocked(updateGitHubRelease).mockImplementation(async (_repoFullName, releaseId, request) => {
      const current = githubReleases.find((release) => release.id === releaseId) ?? githubReleases[0];
      return {
        ...current,
        tagName: request.tagName ?? current.tagName,
        targetCommitish: request.targetCommitish ?? current.targetCommitish,
        name: request.name ?? current.name,
        body: request.body ?? current.body,
        draft: request.draft ?? current.draft,
        prerelease: request.prerelease ?? current.prerelease,
      };
    });
    vi.mocked(deleteGitHubRelease).mockResolvedValue(undefined);
    vi.mocked(pickFiles).mockResolvedValue(["C:\\Files\\release\\lilia.zip"]);
    vi.mocked(uploadGitHubReleaseAsset).mockImplementation(async (_repoFullName, releaseId, filePath) => (
      releaseAsset({ id: 9100, name: filePath.split("\\").pop() ?? filePath, label: null })
    ));
    vi.mocked(attachGitHubWorkflowArtifactAsset).mockImplementation(async (_repoFullName, request) => (
      releaseAsset({
        id: 9200,
        name: request.artifactPath.split("/").pop() ?? request.artifactPath,
        label: request.label ?? null,
        size: 4096,
      })
    ));
    vi.mocked(deleteGitHubReleaseAsset).mockResolvedValue(undefined);
    vi.mocked(listGitHubRepoFiles).mockResolvedValue([]);
    vi.mocked(listGitHubBranches).mockResolvedValue([
      { name: "main", remote: true, current: false, upstream: null, ahead: 0, behind: 0, protected: true, tipTimestamp: null, checkedOutWorktreePaths: [] },
      { name: "feature/settings", remote: true, current: false, upstream: null, ahead: 0, behind: 0, protected: false, tipTimestamp: null, checkedOutWorktreePaths: [] },
    ]);
    vi.mocked(listRepoFiles).mockResolvedValue(localRootFiles);
    vi.mocked(getRepoFilePreview).mockResolvedValue(localReadmePreview);
    vi.mocked(getRepoStorageStats).mockResolvedValue({ logicalBytes: null });
    vi.mocked(listGitHubIssueLabels).mockResolvedValue(["bug", "needs triage", "documentation"]);
    vi.mocked(listGitHubIssueAssignees).mockResolvedValue(["mika", "sena"]);
    vi.mocked(getGitHubIssueFilterMetadata).mockResolvedValue({
      authors: ["sena"],
      labels: ["bug", "needs triage", "documentation"],
      assignees: ["mika", "sena"],
      milestones: [{ number: 1, title: "v1" }],
      projects: [{ id: "PVT_kwDOIssue", title: "Roadmap" }],
    });
    vi.mocked(getGitHubRepoFilePreview).mockRejectedValue(new Error("not found"));
    vi.mocked(getRepoCommitDetail).mockResolvedValue(remoteCommitDetail);
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(getGitHubBranchProtection).mockResolvedValue({
      required_status_checks: { strict: true, contexts: ["CI"] },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: { required_approving_review_count: 1 },
      restrictions: null,
      required_linear_history: { enabled: false },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
    });
    vi.mocked(updateGitHubBranchProtection).mockImplementation(async (_repoFullName, _branchName, request) => request);
    vi.mocked(listGitHubRepoRulesets).mockResolvedValue([]);
    vi.mocked(getGitHubRepoRuleset).mockRejectedValue(new Error("missing ruleset"));
    vi.mocked(updateGitHubRepoRuleset).mockImplementation(async (_repoFullName, rulesetId, request) => ({
      ...request,
      id: rulesetId,
      source_type: "Repository",
      source: "sena-nana/remote-repo",
    }));
    vi.mocked(getGitHubRepoSettingsSection).mockImplementation(async (_repoFullName, section) => settingsSection(section));
    vi.mocked(deleteGitHubBranch).mockResolvedValue(undefined);
    vi.mocked(updateGitHubRepoActionsPermissions).mockResolvedValue(undefined);
    vi.mocked(updateGitHubRepoWorkflowPermissions).mockResolvedValue(undefined);
    vi.mocked(updateGitHubRepoSettings).mockImplementation(async (_repoFullName, request) => ({
      ...githubSettings,
      ...request,
      description: request.description ?? githubSettings.description,
      homepage: request.homepage ?? githubSettings.homepage,
      topics: request.topics ? [...request.topics] : [...githubSettings.topics],
    }));
    vi.mocked(listGitHubPullRequests).mockResolvedValue([]);
    vi.mocked(getGitHubPullRequestDiscussion).mockImplementation(async (_repoFullName, pullNumber) => {
      const pullRequest = githubPullRequests.find((item) => item.number === pullNumber);
      if (!pullRequest) throw new Error(`missing pull ${pullNumber}`);
      return pullRequestDiscussion(pullRequest);
    });
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue([]);
    vi.mocked(mergeGitHubPullRequest).mockImplementation(async () => ({ ...githubPullRequests[0], merged: true, state: "closed" }));
    vi.mocked(listGitHubIssues).mockResolvedValue([]);
    vi.mocked(listGitHubReleases).mockResolvedValue([]);
    vi.mocked(getGitHubIssueDiscussion).mockImplementation(async (_repoFullName, issueNumber) => {
      const issue = githubIssues.find((item) => item.number === issueNumber) ?? closedGitHubIssues.find((item) => item.number === issueNumber);
      if (!issue) throw new Error(`missing issue ${issueNumber}`);
      return issueDiscussion(issue);
    });
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(githubWorkflowRunDetail);
    vi.mocked(getGitHubWorkflowJobLog).mockResolvedValue({
      jobId: 13101,
      content: "##[group]Run tests\nyarn test\npassed\n##[endgroup]",
    });
    vi.mocked(rerunFailedGitHubWorkflowRun).mockResolvedValue(undefined);
    vi.mocked(rerunGitHubWorkflowJob).mockResolvedValue(undefined);
    vi.mocked(listGitHubWorkflowArtifactFiles).mockResolvedValue([
      { path: "README.md", name: "README.md", kind: "file", size: 42 },
    ]);
    vi.mocked(getGitHubWorkflowArtifactFilePreview).mockResolvedValue(filePreview("README.md", "# Artifact\n\nPreview."));
    const workspaceFallback = await workspaceFallbackForTests();
    workspaceFallback.setFallbackGitHubCommitDetailsForTests({
      "sena-nana/remote-repo": {
        [remoteCommit.hash]: remoteCommitDetail,
      },
    });
    vi.mocked(startAuthFlow).mockResolvedValue(undefined);
    state.repos = [];
  });

  it("本地仓库在命令运行页无日志时只显示空输出状态", async () => {
    const view = await renderProjectPanel({ activeGitTab: "run" });

    const terminal = await view.findByLabelText("启动终端");
    expect(within(terminal).getByText("暂无输出。")).toBeInTheDocument();
    expect(within(terminal).queryByText("请选择一个启动指令并运行。")).toBeNull();
    expect(within(terminal).queryByText("当前指令：yarn dev")).toBeNull();
    expect(view.queryByRole("button", { name: "yarn dev" })).toBeNull();
    expect(view.queryByRole("button", { name: "隐藏" })).toBeNull();
    expect(view.queryByRole("button", { name: "运行" })).toBeNull();
  });

  it("侧边栏显示本地仓库语言占比和代码行数", async () => {
    vi.mocked(getRepoStorageStats).mockResolvedValue({ logicalBytes: 12 * 1024 * 1024 });
    const summary = repoSummary("local-repo", {
      languageStats: [
        { language: "TypeScript", bytes: 3000, lines: 120 },
        { language: "Vue", bytes: 1000, lines: 80 },
        { language: "Rust", bytes: 500, lines: 20 },
        { language: "CSS", bytes: 300, lines: 12 },
        { language: "Markdown", bytes: 200, lines: 8 },
      ],
    });
    const view = await renderProjectPanel({
      repoSummary: summary,
      repoFullName: "sena-nana/local-repo",
    });

    const card = await view.findByRole("region", { name: "代码统计" }, { timeout: 5000 });
    expect(within(card).getByText("TypeScript")).toBeInTheDocument();
    expect(within(card).getByText("120 ·")).toBeInTheDocument();
    expect(within(card).getByText("60%")).toBeInTheDocument();
    expect(within(card).getByText("Vue")).toBeInTheDocument();
    expect(within(card).getByText("80 ·")).toBeInTheDocument();
    expect(within(card).getByText("20%")).toBeInTheDocument();
    expect(within(card).getByText("CSS")).toBeInTheDocument();
    expect(within(card).getByText("Other")).toBeInTheDocument();
    expect(within(card).queryByText("Markdown")).toBeNull();
    expect(within(card).getByText("总代码行数")).toBeInTheDocument();
    expect(within(card).getByText("240")).toBeInTheDocument();
    expect(within(card).getByText("项目总大小")).toBeInTheDocument();
    expect(within(card).getByText("12.0 MB")).toBeInTheDocument();
    expect(getRepoStorageStats).toHaveBeenCalledTimes(1);
    expect(getRepoStorageStats).toHaveBeenCalledWith("local-repo");
    const bar = within(card).getByLabelText("代码语言占比");
    const segmentLabels = [...bar.querySelectorAll("[aria-label]")].map((segment) =>
      segment.getAttribute("aria-label"),
    );
    expect(segmentLabels).toEqual(expect.arrayContaining(["TypeScript 60%", "Vue 20%", "Other 4%"]));
  });

  it("远程仓库侧边栏语言统计不显示本地行数", async () => {
    const summary = repoSummary("github:sena-nana/remote-repo", {
      path: "",
      githubFullName: "sena-nana/remote-repo",
      languageStats: [{ language: "TypeScript", bytes: 1000, lines: 40 }],
    });
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoSummary: summary,
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
    });

    const card = await view.findByRole("region", { name: "代码统计" }, { timeout: 5000 });
    expect(within(card).getByText("TypeScript")).toBeInTheDocument();
    expect(within(card).getByText("100%")).toBeInTheDocument();
    expect(within(card).queryByText("40 ·")).toBeNull();
    expect(within(card).queryByText("总代码行数")).toBeNull();
    expect(within(card).queryByText("项目总大小")).toBeNull();
    expect(getRepoStorageStats).not.toHaveBeenCalled();
  });

  it("本地项目大小读取期间显示真实加载状态，索引不可用时不显示为零", async () => {
    const pending = deferred<{ logicalBytes: number | null }>();
    vi.mocked(getRepoStorageStats).mockReturnValue(pending.promise);
    const summary = repoSummary("local-repo", {
      languageStats: [{ language: "TypeScript", bytes: 1000, lines: 40 }],
    });
    const view = await renderProjectPanel({ repoSummary: summary });

    const card = await view.findByRole("region", { name: "代码统计" }, { timeout: 5000 });
    expect(within(card).getByText("项目总大小")).toBeInTheDocument();
    expect(within(card).getByText("读取中…")).toBeInTheDocument();

    pending.resolve({ logicalBytes: null });
    await waitFor(() => expect(within(card).getByText("暂不可用")).toBeInTheDocument());
    expect(within(card).queryByText("0 B")).toBeNull();
  });

  it("启动终端按终端输出渲染 ANSI 颜色和多行日志", async () => {
    const launchLogs: ProjectLaunchLog[] = [
      { index: 1, repoId: "local-repo", stream: "system", line: "启动命令：yarn dev", timestamp: 1 },
      { index: 2, repoId: "local-repo", stream: "stdout", line: "line 1\nline 2", timestamp: 2 },
      { index: 3, repoId: "local-repo", stream: "stdout", line: "\u001b[32mready\u001b[0m <tag>", timestamp: 3 },
      { index: 4, repoId: "local-repo", stream: "stderr", line: "plain error", timestamp: 4 },
    ];

    const view = await renderProjectPanel({
      activeGitTab: "run",
      launchRunning: false,
      launchLogs,
    });

    const terminal = await view.findByLabelText("启动终端");
    expect(terminal).toHaveTextContent("启动命令：yarn dev");
    expect(terminal.textContent).toContain("line 1\nline 2\nready <tag>\nplain error");
    expect(terminal).not.toHaveTextContent("[stdout]");
    expect(terminal).not.toHaveTextContent("[stderr]");
    expect(terminal.querySelector("tag")).toBeNull();
  });

  it("启动终端将动态进度日志折叠为当前行", async () => {
    const launchLogs: ProjectLaunchLog[] = [
      { index: 1, repoId: "local-repo", stream: "system", line: "启动命令：yarn tauri:dev", timestamp: 1 },
      { index: 2, repoId: "local-repo", stream: "stdout", line: "\u001b[36mBuilding 1/3\u001b[0m <old>", writeMode: "replace", timestamp: 2 },
      { index: 3, repoId: "local-repo", stream: "stdout", line: "\u001b[36mBuilding 2/3\u001b[0m <mid>", writeMode: "replace", timestamp: 3 },
      { index: 4, repoId: "local-repo", stream: "stdout", line: "\u001b[32mBuilding 3/3\u001b[0m <done>", writeMode: "append", timestamp: 4 },
      { index: 5, repoId: "local-repo", stream: "stdout", line: "legacy 1\rlegacy 2", timestamp: 5 },
      { index: 6, repoId: "local-repo", stream: "stderr", line: "plain error", timestamp: 6 },
    ];

    const view = await renderProjectPanel({
      activeGitTab: "run",
      launchRunning: false,
      launchLogs,
    });

    const terminal = await view.findByLabelText("启动终端");
    const text = terminal.textContent ?? "";
    expect(terminal).toHaveTextContent("启动命令：yarn tauri:dev");
    expect(text).not.toContain("Building 1/3");
    expect(text).not.toContain("Building 2/3");
    expect(text.match(/Building 3\/3/g)).toHaveLength(1);
    expect(text).not.toContain("legacy 1");
    expect(text).toContain("legacy 2");
    expect(text).toContain("plain error");
    expect(terminal.querySelector("old")).toBeNull();
    expect(terminal.querySelector("done")).toBeNull();
  });

  it("远程仓库只显示项目 tabs，不进入启动工作流", async () => {
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      launchTerminalVisible: true,
      projectTab: "settings",
    });

    expect(view.queryByRole("region", { name: "快速启动" })).toBeNull();
    expect(view.queryByLabelText("启动终端")).toBeNull();
    expect(view.queryByRole("button", { name: "yarn dev" })).toBeNull();
    expect(view.getByRole("tab", { name: "Issues" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Actions" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(view.queryByRole("tab", { name: "分支" })).toBeNull();

    await waitFor(() => {
      expect(view.getByText("删除 GitHub 远端仓库")).toBeInTheDocument();
    });
    expect(view.queryByText("删除本地仓库")).toBeNull();
  });

  it("仓库通知卡仅在存在 GitHub 仓库标识时接入 Settings", async () => {
    const remoteView = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      projectTab: "settings",
    });
    await waitFor(() => {
      expect(remoteView.container.querySelector('[data-agent-id="repo.notifications.card"]')).toBeInTheDocument();
    });
    remoteView.unmount();

    const localView = await renderProjectPanel({ repoFullName: null, projectTab: "settings" });
    expect(localView.container.querySelector('[data-agent-id="repo.notifications.card"]')).toBeNull();
  });

  it("远程仓库历史可打开只读提交详情", async () => {
    const refreshedCommitDetail = {
      ...remoteCommitDetail,
      body: "显式刷新后的远程提交详情。",
    };
    vi.mocked(getRepoCommitDetail).mockImplementation(async (_repoId, _hash, options) => (
      options?.forceRefresh ? refreshedCommitDetail : remoteCommitDetail
    ));
    const view = await renderProjectPanel({
      repoId: "github:sena-nana/remote-repo",
      repoFullName: "sena-nana/remote-repo",
      repoPath: "",
      activeGitTab: "history",
      statusCommits: [remoteCommit],
    });

    await fireEvent.click(await view.findByRole("button", { name: /远程历史提交/ }));
    await view.rerender({ selectedCommitHash: remoteCommit.hash });

    expect(await view.findByLabelText("提交详情卡片")).toBeInTheDocument();
    expect(await view.findByLabelText("提交元数据")).toHaveTextContent("远程历史提交");
    expect(await view.findByLabelText("改动文件列表")).toHaveTextContent("src/remote.ts");

    await view.refreshCurrentPage();

    expect(getRepoCommitDetail).toHaveBeenLastCalledWith(
      "github:sena-nana/remote-repo",
      remoteCommit.hash,
      { forceRefresh: true },
    );
    expect(await view.findByLabelText("提交元数据")).toHaveTextContent("显式刷新后的远程提交详情。");
  });

  it("默认 readme 只加载可见内容，不预取 GitHub 项目分区数据", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await waitFor(() => {
      expect(listRepoFiles).toHaveBeenCalledWith("local-repo", null, undefined, { forceRefresh: false });
    });
    expect(getRepoFilePreview).toHaveBeenCalledWith("local-repo", "README.md", undefined, { forceRefresh: false });
    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();
    expect(await view.findByText("Project README")).toBeInTheDocument();
    expect(view.queryByRole("tab", { name: "文件树" })).toBeNull();
    expect(view.getByRole("tab", { name: "Pull Requests" })).toBeInTheDocument();
    expect(view.getByText("https://example.com/remote")).toBeInTheDocument();
    const topics = view.getByLabelText("Topics");
    expect(within(topics).getByText("vue")).toBeInTheDocument();
    expect(within(topics).getByText("tauri")).toBeInTheDocument();
    expect(view.getByLabelText("BSD-3-Clause license")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Readme" })).toBeNull();
    expect(view.queryByRole("tab", { name: /README\.md/ })).toBeNull();
    expect(view.getByLabelText("128 stars")).toBeInTheDocument();
    expect(view.getByLabelText("9 watching")).toBeInTheDocument();
    expect(view.getByLabelText("14 forks")).toBeInTheDocument();
    expect(getGitHubRepoManagement).toHaveBeenCalledTimes(1);
    expect(getGitHubIssueFilterMetadata).not.toHaveBeenCalled();
    expect(listGitHubIssueLabels).not.toHaveBeenCalled();
    expect(listGitHubIssueAssignees).not.toHaveBeenCalled();
    expect(listGitHubRepoFiles).not.toHaveBeenCalled();
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();
  });

  it("README 页面显式刷新绕过缓存并更新当前内容", async () => {
    vi.mocked(listRepoFiles).mockImplementation(async (_repoId, _parentPath, _repoRef, options) => (
      options?.forceRefresh ? [repoFile("README.md")] : localRootFiles
    ));
    vi.mocked(getRepoFilePreview).mockImplementation(async (_repoId, path, _repoRef, options) => (
      filePreview(path, options?.forceRefresh ? "# Refreshed README" : "# Project README")
    ));
    const view = await renderProjectPanel();

    expect(await view.findByText("Project README")).toBeInTheDocument();
    await view.refreshCurrentPage();

    expect(await view.findByText("Refreshed README")).toBeInTheDocument();
    expect(getRepoFilePreview).toHaveBeenLastCalledWith(
      "local-repo",
      "README.md",
      undefined,
      { forceRefresh: true },
    );
  });

  it("Files 页面显式刷新重载文件树和当前预览", async () => {
    vi.mocked(listRepoFiles).mockImplementation(async (_repoId, parentPath, _repoRef, options) => {
      if (parentPath) return [];
      return options?.forceRefresh ? [repoFile("CHANGELOG.md")] : [repoFile("README.md")];
    });
    vi.mocked(getRepoFilePreview).mockImplementation(async (_repoId, path, _repoRef, options) => (
      filePreview(path, options?.forceRefresh ? "Updated file preview" : "Initial file preview")
    ));
    const view = await renderProjectPanel({}, "/repos/local-repo/files");

    expect(await view.findByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(await view.findByText("Initial file preview")).toBeInTheDocument();
    await view.refreshCurrentPage();

    expect(await view.findByRole("button", { name: "CHANGELOG.md" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "README.md" })).toBeNull();
    expect(await view.findByText("Updated file preview")).toBeInTheDocument();
    expect(getRepoFilePreview).toHaveBeenLastCalledWith(
      "local-repo",
      "CHANGELOG.md",
      null,
      { forceRefresh: true },
    );
  });

  it("文件树右键菜单把目录入口接到本地打开目标", async () => {
    vi.mocked(listRepoFiles).mockImplementation(async (_repoId, parentPath) => (
      parentPath === "src"
        ? [repoFile("src/App.vue")]
        : [repoDir("src"), repoFile("README.md")]
    ));
    vi.mocked(getRepoFilePreview).mockImplementation(async (_repoId, path) => filePreview(path, "content"));

    const view = await renderProjectPanel({}, "/repos/local-repo/files");
    const srcRow = await view.findByRole("button", { name: "src" });
    const srcPath = "C:\\Files\\workspace\\local-repo\\src";

    for (const [label, target] of localOpenTargetCases) {
      await expectTreeOpenTarget(srcRow, label, target, srcPath);
    }

    await fireEvent.click(srcRow);
    const appFileRow = await view.findByRole("button", { name: "App.vue" });

    for (const [label, target] of localOpenTargetCases) {
      await expectTreeOpenTarget(appFileRow, label, target, srcPath);
    }
  });

  it("文件树右键菜单在没有本地路径时不显示本地打开入口", async () => {
    vi.mocked(listRepoFiles).mockResolvedValue([repoFile("README.md")]);
    vi.mocked(getRepoFilePreview).mockImplementation(async (_repoId, path) => filePreview(path, "content"));

    const view = await renderProjectPanel({ repoPath: "" }, "/repos/local-repo/files");
    const readmeRow = await view.findByRole("button", { name: "README.md" });
    const contextMenu = useContextMenu();

    closeContextMenu();
    await fireEvent.contextMenu(readmeRow);

    expect(contextMenu.state.open).toBe(false);
    expect(openPathTarget).not.toHaveBeenCalled();
  });

  it("仓库设置读取失败时右侧错误卡不替换仓库侧栏", async () => {
    const message = "读取 GitHub 仓库设置失败：HTTP 404 Not Found";
    vi.mocked(getGitHubRepoManagement).mockRejectedValue(message);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    const errorCard = await view.findByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("GitHub 请求失败");
    expect(errorCard).toHaveTextContent(message);
    expect(view.getByRole("region", { name: "仓库描述" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "代码统计" })).toBeInTheDocument();
    expect(view.getAllByText(message)).toHaveLength(1);
  });

  it("README 读取失败时只在右侧错误区显示", async () => {
    const message = "读取 README 失败：HTTP 404 Not Found";
    vi.mocked(listRepoFiles).mockRejectedValue(message);

    const view = await renderProjectPanel();

    const errorCard = await view.findByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("README 读取失败");
    expect(errorCard).toHaveTextContent(message);
    expect(view.getAllByText(message)).toHaveLength(1);
  });

  it("仓库操作错误和同步错误固定显示在右侧错误区", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/local-repo",
      activeGitTab: "changes",
      actionError: "操作失败：无法提交",
      repoSyncIssue: {
        label: "最近同步失败",
        message: "认证失败",
        retryable: true,
        retrying: false,
        updatedAt: 1,
      },
    });

    const errorCard = view.getByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("最近同步失败");
    expect(errorCard).toHaveTextContent("认证失败");
    expect(errorCard).toHaveTextContent("状态");
    expect(errorCard).toHaveTextContent("认证或权限失效");
    expect(errorCard).toHaveTextContent("原因");
    expect(errorCard).toHaveTextContent("GitHub 凭证失效、权限不足或当前账号无法访问该仓库。");
    expect(errorCard).toHaveTextContent("下一步");
    expect(errorCard).toHaveTextContent("重新绑定 GitHub");
    expect(errorCard).toHaveTextContent("操作失败");
    expect(errorCard).toHaveTextContent("操作失败：无法提交");
    expect(within(errorCard).getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "仓库描述" })).toBeInTheDocument();
  });

  it("同一次仓库操作失败在右侧错误区只显示一次", async () => {
    const message = "Error: 合并失败：not something we can merge";
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/local-repo",
      activeGitTab: "changes",
      actionError: message,
      repoSyncIssue: {
        label: "仓库操作失败",
        message,
        retryable: false,
        retrying: false,
        updatedAt: 1,
      },
    });

    const errorCard = view.getByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("仓库操作失败");
    expect(within(errorCard).getAllByText(message)).toHaveLength(1);
    expect(within(errorCard).queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("最近同步错误去重后保留重试中状态", async () => {
    const message = "认证失败";
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/local-repo",
      activeGitTab: "changes",
      actionError: message,
      repoSyncIssue: {
        label: "最近同步失败",
        message,
        retryable: true,
        retrying: true,
        updatedAt: 1,
      },
    });

    const errorCard = view.getByRole("region", { name: "仓库错误" });
    expect(errorCard).toHaveTextContent("最近同步失败");
    expect(within(errorCard).getAllByText(message)).toHaveLength(1);
    expect(within(errorCard).getByRole("button", { name: "重试" })).toBeDisabled();
  });

  it("仓库描述标签超过两行时显示展开和收起按钮", async () => {
    vi.mocked(getGitHubRepoManagement).mockResolvedValue({
      ...githubSettings,
      topics: ["vue", "tauri", "codex", "openai-compatible", "project-management"],
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await view.findByText("Remote repository tools");
    const topicList = view.container.querySelector(".project-topic-list:not(.project-topic-list--measure)");
    const measureList = view.container.querySelector(".project-topic-list--measure");
    expect(topicList).toBeInstanceOf(HTMLElement);
    expect(measureList).toBeInstanceOf(HTMLElement);
    const topics = Array.from(measureList?.querySelectorAll(".project-topic-pill") ?? []);
    [0, 0, 26, 26, 52].forEach((top, index) => {
      Object.defineProperty(topics[index], "offsetTop", { configurable: true, value: top });
    });
    await fireEvent(window, new Event("resize"));

    const expandButton = await view.findByRole("button", { name: "展开" });
    expect(topicList).toContainElement(expandButton);
    expect(within(topicList as HTMLElement).queryByText("project-management")).toBeNull();
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    await fireEvent.click(expandButton);
    expect(within(topicList as HTMLElement).getByText("project-management")).toBeInTheDocument();
    const collapseButton = view.getByRole("button", { name: "收起" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await fireEvent.click(collapseButton);
    expect(within(topicList as HTMLElement).queryByText("project-management")).toBeNull();
    expect(view.getByRole("button", { name: "展开" })).toHaveAttribute("aria-expanded", "false");
  });

  it("首次进入项目页不预热 GitHub 项目元数据，进入分区后再请求", async () => {
    vi.mocked(getGitHubRepoManagement).mockResolvedValue(githubSettings);
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue(githubWorkflowRuns);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await view.findByText("Remote repository tools");
    expect(getGitHubIssueFilterMetadata).not.toHaveBeenCalled();
    expect(listGitHubIssueLabels).not.toHaveBeenCalled();
    expect(listGitHubIssueAssignees).not.toHaveBeenCalled();
    expect(listGitHubRepoFiles).not.toHaveBeenCalled();
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubPullRequests).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByRole("region", { name: "GitHub 功能" })).toBeInTheDocument();
    const settingsNav = view.getByRole("navigation", { name: "设置分类" });
    expect(within(settingsNav).getByRole("button", { name: "协作与访问" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "GitHub 功能" })).toBeInTheDocument();
    expect(getGitHubRepoManagement).toHaveBeenCalledTimes(1);
    expect(listGitHubIssues).not.toHaveBeenCalled();
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载", {}, { timeout: 5000 })).toBeInTheDocument();
    const issueFilters = view.getByLabelText("Issue 筛选项");
    expect(within(issueFilters).getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector(".project-main")?.querySelector("[aria-label='Issue 筛选项']")).toBeNull();
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "open" }),
      );
    });
    expect(getGitHubIssueFilterMetadata).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
    expect(listGitHubWorkflowRuns).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("tab", { name: "Actions" }));
    expect(await view.findByRole("button", { name: /release pipeline/ }, { timeout: 5000 })).toBeInTheDocument();
    const actionSummary = await view.findByLabelText("Actions 摘要");
    expect(actionSummary).toHaveTextContent("1");
    expect(actionSummary).toHaveTextContent("已同步");
    await waitFor(() => {
      expect(listGitHubWorkflowRuns).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        20,
      );
    });
    expect(getGitHubWorkflowRunDetail).not.toHaveBeenCalled();
  });

  it.each([
    {
      createFlow: "issue",
      projectTab: "issues",
      formName: "新建 Issue",
      expectedText: null,
    },
    {
      createFlow: "pull",
      projectTab: "pulls",
      formName: "新建 PR",
      expectedText: null,
    },
    {
      createFlow: "release",
      projectTab: "release",
      formName: "Release 表单",
      expectedText: "New release",
    },
  ])("create $createFlow 路由直接打开创建表单", async ({ createFlow, projectTab, formName, expectedText }) => {
    const view = await renderProjectPanel(
      { repoFullName: "sena-nana/remote-repo" },
      `/repos/local-repo?projectTab=${projectTab}&create=${createFlow}`,
    );

    const form = await view.findByRole("form", { name: formName });
    if (expectedText) expect(within(form).getByText(expectedText)).toBeInTheDocument();
    await fireEvent.click(within(form).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.query).not.toHaveProperty("create");
    });
  });

  it("Release 二级 Tab 读取 releases，并在右侧 tag 列表跳转和刷新", async () => {
    vi.mocked(listGitHubReleases).mockResolvedValue(githubReleases);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Release" }));

    expect(await view.findByRole("heading", { level: 4, name: "Lilia v1.0.0" })).toBeInTheDocument();
    expect(view.getByText("lilia-windows.zip")).toBeInTheDocument();
    const releaseTimeline = view.getByRole("list", { name: "Release 列表" });
    const latestReleaseCard = releaseTimeline.querySelector(".release-card[data-release-tag=\"v1.0.0\"]") as HTMLElement;
    expect(latestReleaseCard).toBeInstanceOf(HTMLElement);
    expect(within(releaseTimeline).getByText("Lilia v1.0.0")).toBeInTheDocument();
    expect(within(releaseTimeline).getByText(/Lilia v1\.1 beta/i)).toBeInTheDocument();
    expect(within(latestReleaseCard).queryByText("Target main")).toBeNull();
    expect(within(latestReleaseCard).getByRole("heading", { level: 2, name: "Summary" })).toBeInTheDocument();
    const expandBodyButton = within(latestReleaseCard).getByRole("button", { name: "展开" });
    expect(expandBodyButton).toHaveAttribute("aria-expanded", "false");
    await fireEvent.click(expandBodyButton);
    expect(within(latestReleaseCard).getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
    expect(within(latestReleaseCard).queryByText("lilia-linux.AppImage")).toBeNull();
    await fireEvent.click(within(latestReleaseCard).getByRole("button", { name: "更多 1" }));
    expect(within(latestReleaseCard).getByText("lilia-linux.AppImage")).toBeInTheDocument();
    const prereleaseCard = releaseTimeline.querySelector(".release-card[data-release-tag=\"v1.1.0-beta.1\"]") as HTMLElement;
    expect(prereleaseCard).toBeInstanceOf(HTMLElement);
    expect(within(prereleaseCard).queryByText("Pre-release")).toBeNull();
    expect(view.queryByText("No assets.")).toBeNull();
    expect(latestReleaseCard).toHaveTextContent("sena");
    expect(listGitHubReleases).toHaveBeenCalledWith("sena-nana/remote-repo");
    expect(view.router.currentRoute.value.query).toMatchObject({ projectTab: "release" });

    const filterSidebar = view.getByRole("region", { name: "Release 筛选" });
    expect(within(filterSidebar).getByRole("button", { name: "新建 Release" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "刷新当前页" })).toBeNull();
    expect(within(filterSidebar).getByRole("button", { name: "清除筛选" })).toBeDisabled();
    await fireEvent.click(within(filterSidebar).getByRole("button", { name: /v1\.0\.0/ }));

    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "release",
        releaseTag: "v1.0.0",
      });
    });
    expect(within(releaseTimeline).getByText("Lilia v1.0.0")).toBeInTheDocument();
    expect(within(releaseTimeline).queryByText(/Lilia v1\.1 beta/i)).toBeNull();

    await fireEvent.click(within(filterSidebar).getByRole("button", { name: /清除筛选/ }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).not.toHaveProperty("releaseTag");
    });
    expect(within(releaseTimeline).getByText(/Lilia v1\.1 beta/i)).toBeInTheDocument();

    await fireEvent.click(within(filterSidebar).getByRole("button", { name: "全部" }));
    await fireEvent.click(await view.findByRole("option", { name: "Pre-release" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "release",
        releaseType: "prerelease",
      });
    });
    expect(within(releaseTimeline).queryByText("Lilia v1.0.0")).toBeNull();
    expect(within(releaseTimeline).getByText(/Lilia v1\.1 beta/i)).toBeInTheDocument();

    await view.refreshCurrentPage();
    expect(listGitHubReleases).toHaveBeenLastCalledWith("sena-nana/remote-repo", { forceRefresh: true });
  });

  it("Release Tab 支持创建、编辑、删除 release 与上传、删除资产", async () => {
    vi.mocked(listGitHubReleases).mockResolvedValue([githubReleases[0]]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Release" }));
    await view.findByRole("heading", { level: 4, name: "Lilia v1.0.0" });

    const filterSidebar = view.getByRole("region", { name: "Release 筛选" });
    await fireEvent.click(within(filterSidebar).getByRole("button", { name: "新建 Release" }));
    const createForm = await view.findByRole("form", { name: "Release 表单" });
    await fireEvent.update(within(createForm).getByLabelText("Tag"), "v1.1.0");
    await fireEvent.update(within(createForm).getByLabelText("Target"), "main");
    await fireEvent.update(within(createForm).getByLabelText("Title"), "Lilia v1.1.0");
    await fireEvent.update(within(createForm).getByLabelText("Notes"), "新增 release 管理。");
    await fireEvent.click(within(createForm).getByLabelText("Generate notes"));
    await fireEvent.click(within(createForm).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(createGitHubRelease).toHaveBeenCalledWith("sena-nana/remote-repo", {
        tagName: "v1.1.0",
        targetCommitish: "main",
        name: "Lilia v1.1.0",
        body: "新增 release 管理。",
        draft: false,
        prerelease: false,
        generateReleaseNotes: true,
      });
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({ releaseTag: "v1.1.0" });
    });
    await fireEvent.click(within(filterSidebar).getByRole("button", { name: /清除筛选/ }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).not.toHaveProperty("releaseTag");
    });

    let releaseCard: HTMLElement | null = null;
    await waitFor(() => {
      releaseCard = view.container.querySelector(".release-card[data-release-tag=\"v1.0.0\"]");
      expect(releaseCard).toBeInstanceOf(HTMLElement);
    });
    const releaseCardElement = releaseCard as HTMLElement;
    const releaseActionsButton = within(releaseCardElement).getByRole("button", { name: "编辑 Release 菜单" });
    expect(within(releaseCardElement).queryByRole("button", { name: "打开 Release" })).toBeNull();
    expect(within(releaseCardElement).queryByRole("button", { name: "上传资产" })).toBeNull();
    expect(within(releaseCardElement).queryByRole("button", { name: "删除 Release" })).toBeNull();

    const contextMenu = useContextMenu();
    await fireEvent.click(releaseActionsButton);
    const uploadItem = contextMenu.state.items.find((item) => item.label === "上传资产");
    expect(uploadItem).toBeTruthy();
    await selectContextMenuItem(uploadItem!);
    await waitFor(() => {
      expect(pickFiles).toHaveBeenCalledTimes(1);
      expect(uploadGitHubReleaseAsset).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        8001,
        "C:\\Files\\release\\lilia.zip",
      );
    });

    const originalAssetRow = within(releaseCardElement).getByText("lilia-windows.zip").closest(".release-asset") as HTMLElement;
    expect(within(originalAssetRow).queryByRole("button", { name: "删除资产" })).toBeNull();
    await fireEvent.click(releaseActionsButton);
    const deleteAssetsItem = contextMenu.state.items.find((item) => item.label === "删除资产");
    expect(deleteAssetsItem?.children).toHaveLength(3);
    await selectContextMenuItem(deleteAssetsItem!);
    const deleteAssetItem = contextMenu.state.items.find((item) => item.label === "lilia-windows.zip");
    expect(deleteAssetItem).toBeTruthy();
    await selectContextMenuItem(deleteAssetItem!);
    expect(deleteGitHubReleaseAsset).not.toHaveBeenCalled();
    await selectContextMenuItem(deleteAssetItem!);
    await waitFor(() => {
      expect(deleteGitHubReleaseAsset).toHaveBeenCalledWith("sena-nana/remote-repo", 8001, 9001);
    });

    await fireEvent.click(releaseActionsButton);
    const editItem = contextMenu.state.items.find((item) => item.label === "编辑 Release");
    expect(editItem).toBeTruthy();
    await selectContextMenuItem(editItem!);
    const editForm = await view.findByRole("form", { name: "Release 表单" });
    await fireEvent.update(within(editForm).getByLabelText("Title"), "Lilia v1.0.1");
    await fireEvent.click(within(editForm).getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(updateGitHubRelease).toHaveBeenCalledWith("sena-nana/remote-repo", 8001, expect.objectContaining({
        tagName: "v1.0.0",
        name: "Lilia v1.0.1",
      }));
    });

    await fireEvent.click(releaseActionsButton);
    const deleteItem = contextMenu.state.items.find((item) => item.label === "删除 Release");
    expect(deleteItem).toBeTruthy();
    await selectContextMenuItem(deleteItem!);
    expect(deleteGitHubRelease).not.toHaveBeenCalled();
    await selectContextMenuItem(deleteItem!);
    await waitFor(() => {
      expect(deleteGitHubRelease).toHaveBeenCalledWith("sena-nana/remote-repo", 8001);
    });
  });

  it("Release 选择本地资产期间阻止重复选择，并在取消后恢复操作", async () => {
    const picker = deferred<string[]>();
    vi.mocked(listGitHubReleases).mockResolvedValue([githubReleases[0]]);
    vi.mocked(pickFiles).mockReturnValue(picker.promise);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Release" }));
    await view.findByRole("heading", { level: 4, name: "Lilia v1.0.0" });

    const releaseCard = view.container.querySelector(".release-card[data-release-tag=\"v1.0.0\"]") as HTMLElement;
    const releaseActionsButton = within(releaseCard).getByRole("button", { name: "编辑 Release 菜单" });
    const contextMenu = useContextMenu();
    await fireEvent.click(releaseActionsButton);
    const uploadItem = contextMenu.state.items.find((item) => item.label === "上传资产");
    expect(uploadItem).toBeTruthy();

    await selectContextMenuItem(uploadItem!);
    await selectContextMenuItem(uploadItem!);

    expect(pickFiles).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(releaseActionsButton).toBeDisabled());
    expect(uploadGitHubReleaseAsset).not.toHaveBeenCalled();

    picker.resolve([]);
    await waitFor(() => expect(releaseActionsButton).not.toBeDisabled());
    expect(uploadGitHubReleaseAsset).not.toHaveBeenCalled();
  });

  it("Release Tab 显示空态和 GitHub 不可用态", async () => {
    const emptyView = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(emptyView.getByRole("tab", { name: "Release" }));

    expect(await emptyView.findByText("暂无 releases。")).toBeInTheDocument();
    expect(emptyView.getByText("暂无 release tag。")).toBeInTheDocument();
    emptyView.unmount();

    vi.mocked(listGitHubReleases).mockRejectedValue(new Error("GitHub 绑定已失效，请重新绑定"));
    const unavailableView = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(unavailableView.getByRole("tab", { name: "Release" }));

    expect(await unavailableView.findByText("Release 暂不可用")).toBeInTheDocument();
    expect(unavailableView.getAllByText(/GitHub 绑定已失效/).length).toBeGreaterThan(0);
    expect(unavailableView.queryByRole("button", { name: "新建 Release" })).toBeNull();
  });

  it("点击 Issue 行进入详情并渲染 Markdown 正文、评论和事件", async () => {
    const issueWithBody: GitHubIssue = {
      ...githubIssues[0],
      body: "## 复现步骤\n\n- 打开 <script>alert(1)</script> [文档](docs/guide.md)",
      developmentItems: [{
        id: "pull:sena-nana/remote-repo:52",
        kind: "pullRequest",
        label: "PR #52 接入 Pull Request 工作流",
        url: "https://github.com/sena-nana/remote-repo/pull/52",
        number: 52,
        state: "open",
        repositoryFullName: "sena-nana/remote-repo",
      }],
    };
    vi.mocked(listGitHubIssues).mockResolvedValue([issueWithBody]);
    vi.mocked(getGitHubIssueDiscussion).mockResolvedValue({
      issue: issueWithBody,
      timeline: [
        {
          id: "issue-12-body",
          kind: "body",
          actor: "sena",
          body: issueWithBody.body,
          url: issueWithBody.htmlUrl,
          createdAt: "2026-06-18T08:00:00Z",
          updatedAt: "2026-06-18T08:00:00Z",
        },
        {
          id: "comment-1",
          kind: "comment",
          actor: "mika",
          body: "**确认** 已复现",
          url: "https://github.com/sena-nana/remote-repo/issues/12#issuecomment-1",
          createdAt: "2026-06-18T08:01:00Z",
          updatedAt: "2026-06-18T08:01:00Z",
        },
        {
          id: "event-closed",
          kind: "event",
          actor: "sena",
          event: "closed",
          title: "关闭了讨论",
          createdAt: "2026-06-18T08:02:00Z",
        },
      ],
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    await fireEvent.click(await view.findByText("#12 修复懒加载"));

    expect(await view.findByRole("heading", { level: 3, name: "#12 修复懒加载" })).toBeInTheDocument();
    expect(getGitHubIssueDiscussion).toHaveBeenCalledWith("sena-nana/remote-repo", 12);
    expect(view.getByRole("heading", { level: 2, name: "复现步骤" })).toBeInTheDocument();
    expect(view.getByText("确认")).toBeInTheDocument();
    expect(view.getByText("已复现")).toBeInTheDocument();
    expect(view.getByText("关闭了讨论")).toBeInTheDocument();
    expect(view.container.querySelector(".issue-detail__summary")).toBeNull();
    const issueSidebar = await view.findByLabelText("Issue 详情侧栏");
    expect(issueSidebar).toHaveTextContent("Issue #12");
    expect(issueSidebar).toHaveTextContent("打开");
    expect(issueSidebar).toHaveTextContent("sena");
    expect(issueSidebar).toHaveTextContent("bug");
    expect(issueSidebar).toHaveTextContent("Roadmap");
    expect(issueSidebar).toHaveTextContent("v1");
    expect(issueSidebar).toHaveTextContent("PR #52 接入 Pull Request 工作流");
    expect(issueSidebar).not.toHaveTextContent("暂无关联开发项");
    expect(view.queryByLabelText("Issue 筛选项")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({ projectTab: "issues", issue: "12" });
    });
  });

  it("Issues 默认按里程碑分组且相同标题的里程碑保持独立", async () => {
    const issues: GitHubIssue[] = [
      githubIssues[0],
      {
        ...githubIssues[0],
        number: 66,
        title: "整理文档",
        milestone: { number: 2, title: "v2", state: "closed" },
        htmlUrl: "https://github.com/sena-nana/remote-repo/issues/66",
      },
      {
        ...githubIssues[0],
        number: 77,
        title: "准备补丁版本",
        milestone: { number: 3, title: "v1", state: "open" },
        htmlUrl: "https://github.com/sena-nana/remote-repo/issues/77",
      },
      {
        ...githubIssues[0],
        number: 88,
        title: "未排期事项",
        milestone: null,
        htmlUrl: "https://github.com/sena-nana/remote-repo/issues/88",
      },
      {
        ...githubIssues[0],
        number: 99,
        title: "补充发布说明",
        milestone: { number: 1, title: "v1", state: "open" },
        htmlUrl: "https://github.com/sena-nana/remote-repo/issues/99",
      },
    ];
    vi.mocked(listGitHubIssues).mockResolvedValue(issues);
    const view = await renderProjectPanel({ repoFullName: "sena-nana/remote-repo" });

    expect(view.queryByRole("tab", { name: "Milestones" })).toBeNull();
    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));

    await view.findByText("#12 修复懒加载");
    const issueList = await view.findByRole("list", { name: "Issues" });
    expect(within(issueList).getAllByLabelText("v1 Issues")).toHaveLength(2);
    expect(within(issueList).getByLabelText("v2 Issues")).toHaveTextContent("#66 整理文档");
    expect(within(issueList).getByLabelText("无里程碑 Issues")).toHaveTextContent("#88 未排期事项");
    expect(issueList.querySelector('[data-agent-id="repo.issues.group.milestone.1"]')).not.toBeNull();
    expect(issueList.querySelector('[data-agent-id="repo.issues.group.milestone.3"]')).not.toBeNull();
    expect(issueList.querySelector('[data-agent-id="repo.issues.group.none"]')).not.toBeNull();
    expect([
      ...issueList.querySelectorAll<HTMLElement>(":scope > [data-agent-id^='repo.issues.group.']"),
    ].map((group) => group.dataset.agentId)).toEqual([
      "repo.issues.group.milestone.1",
      "repo.issues.group.milestone.3",
      "repo.issues.group.milestone.2",
      "repo.issues.group.none",
    ]);
    const v1Group = issueList.querySelector<HTMLElement>('[data-agent-id="repo.issues.group.milestone.1"]')!;
    expect(within(v1Group).getAllByRole("button").filter((button) => button.dataset.agentId?.endsWith(".open"))
      .map((button) => button.textContent?.trim())).toEqual([
        "#12 修复懒加载",
        "#99 补充发布说明",
      ]);
    expect(view.queryByText("#52 接入 Pull Request 工作流")).toBeNull();
    expect(listGitHubPullRequests).not.toHaveBeenCalled();
  });

  it("Issues 分组在全局渐进显示时保留完整计数且不遗漏事项", async () => {
    const issues = Array.from({ length: 52 }, (_, index): GitHubIssue => ({
      ...githubIssues[0],
      number: 100 + index,
      title: `批量事项 ${index + 1}`,
      milestone: index < 51 ? { number: 1, title: "v1", state: "open" } : null,
      htmlUrl: `https://github.com/sena-nana/remote-repo/issues/${100 + index}`,
    }));
    vi.mocked(listGitHubIssues).mockResolvedValue(issues);
    const view = await renderProjectPanel({ repoFullName: "sena-nana/remote-repo" });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    await view.findByText("#100 批量事项 1");
    const issueList = await view.findByRole("list", { name: "Issues" });
    expect(within(issueList).getByLabelText("50 / 51 Issues")).toBeInTheDocument();
    expect(within(issueList).queryByLabelText("无里程碑 Issues")).toBeNull();

    await fireEvent.click(within(issueList).getByRole("button", { name: "显示更多 2 个" }));
    expect(within(issueList).getByLabelText("51 / 51 Issues")).toBeInTheDocument();
    expect(within(issueList).getByLabelText("无里程碑 Issues")).toHaveTextContent("#151 批量事项 52");
    expect(within(issueList).queryByRole("button", { name: /显示更多/ })).toBeNull();
  });

  it("Issues 首次请求完成前显示真实加载状态", async () => {
    const pending = deferred<GitHubIssue[]>();
    vi.mocked(listGitHubIssues).mockReturnValue(pending.promise);
    const view = await renderProjectPanel({ repoFullName: "sena-nana/remote-repo" });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("正在读取 Issues。")).toBeInTheDocument();
    expect(view.queryByText("没有匹配的 Issue。")).toBeNull();

    pending.resolve(githubIssues);
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.queryByText("正在读取 Issues。")).toBeNull();
  });

  it("Actions 列表同一行显示标题与右侧信息，并省略同名来源", async () => {
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([
      githubWorkflowRuns[0],
      {
        ...githubWorkflowRuns[0],
        id: 1311,
        name: "same action",
        displayTitle: "same action",
        branch: "feature/same",
      },
    ]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
    });

    const workflowRun = await view.findByRole("button", { name: /release pipeline/ }, { timeout: 5000 });
    const sameNameRun = view.getByRole("button", { name: /same action/ });
    expect(workflowRun).toHaveTextContent(/CI · main · /);
    expect(sameNameRun).toHaveTextContent(/feature\/same · /);
    expect(sameNameRun.textContent?.match(/same action/g)).toHaveLength(1);
  });

  it("Actions 右侧显示 run、job、step 和按需日志并预览 artifact", async () => {
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue(githubWorkflowRuns);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(githubWorkflowRunDetail);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
      projectJobId: 13103,
    });

    expect(await view.findByRole("heading", { level: 3, name: "release pipeline" })).toBeInTheDocument();
    expect(await view.findByRole("button", { name: /release pipeline/ })).toBeInTheDocument();
    expect(view.getByLabelText("Actions 运行列表")).toHaveTextContent("release pipeline");
    expect(getGitHubWorkflowRunDetail).toHaveBeenCalledWith("sena-nana/remote-repo", 1310, { forceRefresh: false });
    expect(view.getByText("Run tests")).toBeInTheDocument();
    expect(getGitHubWorkflowJobLog).not.toHaveBeenCalled();

    await fireEvent.click(view.getByRole("button", { name: "查看日志" }));
    expect((await view.findAllByText(/yarn test/)).length).toBeGreaterThan(0);
    expect(getGitHubWorkflowJobLog).toHaveBeenCalledWith("sena-nana/remote-repo", 13103, { forceRefresh: false });

    await fireEvent.click(view.getByText("dist"));
    const artifactFile = await view.findByRole("button", { name: /README\.md/ });
    await fireEvent.click(artifactFile);
    expect(await view.findByText("Artifact")).toBeInTheDocument();
    expect(getGitHubWorkflowArtifactFilePreview).toHaveBeenCalledWith("sena-nana/remote-repo", 131001, "README.md");

    await view.refreshCurrentPage();
    await waitFor(() => {
      expect(listGitHubWorkflowRuns).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        20,
        { forceRefresh: true },
      );
      expect(getGitHubWorkflowRunDetail).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        1310,
        { forceRefresh: true },
      );
    });
  });

  it("失败 Actions 可定位节点并分别重跑失败任务和 job", async () => {
    const failedDetail = failedWorkflowRunDetail();
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([failedDetail.run]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(failedDetail);
    vi.mocked(getGitHubWorkflowJobLog).mockResolvedValue({
      jobId: 13103,
      content: "##[group]Run tests\nyarn test\n::error file=tests/app.test.ts::assertion failed\n##[endgroup]",
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
      projectJobId: 13103,
    });

    expect(await view.findByText("失败位置")).toBeInTheDocument();
    expect(view.getByText("test · Run tests")).toBeInTheDocument();
    expect(view.container.querySelector('[data-job-id="13103"].is-active')).not.toBeNull();

    await fireEvent.click(view.getByRole("button", { name: "查看日志" }));
    expect(await view.findByText("错误摘要")).toBeInTheDocument();
    expect(view.getAllByText(/assertion failed/).length).toBeGreaterThan(0);

    const runListRequestCount = vi.mocked(listGitHubWorkflowRuns).mock.calls.length;
    await fireEvent.click(view.getByRole("button", { name: "重跑失败任务" }));
    await waitFor(() => {
      expect(rerunFailedGitHubWorkflowRun).toHaveBeenCalledWith("sena-nana/remote-repo", 1310);
      expect(getGitHubWorkflowRunDetail).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        1310,
        { forceRefresh: true },
      );
    });
    expect(listGitHubWorkflowRuns).toHaveBeenCalledTimes(runListRequestCount);

    const rerunJob = view.getByRole("button", { name: "重跑 Job" });
    await waitFor(() => expect(rerunJob).not.toBeDisabled());
    await fireEvent.click(rerunJob);
    await waitFor(() => {
      expect(rerunGitHubWorkflowJob).toHaveBeenCalledWith("sena-nana/remote-repo", 13103);
    });
  });

  it("Actions 重跑权限错误可见且入口恢复可重试", async () => {
    const failedDetail = failedWorkflowRunDetail();
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([failedDetail.run]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(failedDetail);
    vi.mocked(rerunFailedGitHubWorkflowRun)
      .mockRejectedValueOnce(new Error("HTTP 403 Forbidden"))
      .mockResolvedValueOnce(undefined);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
    });

    const rerun = await view.findByRole("button", { name: "重跑失败任务" });
    await fireEvent.click(rerun);
    expect(await view.findByText(/没有重跑权限/)).toBeInTheDocument();
    expect(rerun).not.toBeDisabled();

    await fireEvent.click(rerun);
    await waitFor(() => expect(rerunFailedGitHubWorkflowRun).toHaveBeenCalledTimes(2));
    expect(await view.findByText("已提交失败任务重跑。")).toBeInTheDocument();
  });

  it("Actions 重跑提交期间阻止重复操作并显示进行中状态", async () => {
    const failedDetail = failedWorkflowRunDetail();
    const pending = deferred<void>();
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([failedDetail.run]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(failedDetail);
    vi.mocked(rerunFailedGitHubWorkflowRun).mockReturnValue(pending.promise);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
    });

    await fireEvent.click(await view.findByRole("button", { name: "重跑失败任务" }));
    const running = view.getByRole("button", { name: "正在重跑" });
    expect(running).toBeDisabled();
    expect(view.getByRole("button", { name: "重跑 Job" })).toBeDisabled();

    pending.resolve();
    expect(await view.findByText("已提交失败任务重跑。")).toBeInTheDocument();
  });

  it("Actions 失效 job 深链和缺少错误摘要都有明确降级状态", async () => {
    const failedDetail = failedWorkflowRunDetail();
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([failedDetail.run]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(failedDetail);
    vi.mocked(getGitHubWorkflowJobLog).mockResolvedValue({ jobId: 13103, content: "plain test output" });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
      projectJobId: 99999,
    });

    expect(await view.findByText("该 job 不存在或已失效。")).toBeInTheDocument();
    await fireEvent.click(view.getByRole("button", { name: "查看日志" }));
    expect(await view.findByText("未从日志中提取到错误摘要，请查看 step 日志。")).toBeInTheDocument();
    expect(view.getAllByText("完整 job 日志").length).toBeGreaterThan(0);
  });

  it("Actions 重跑上限和过期 artifact 显示真实不可用状态", async () => {
    const failedDetail = failedWorkflowRunDetail();
    failedDetail.run.runAttempt = 50;
    failedDetail.artifacts = failedDetail.artifacts.map((artifact) => ({ ...artifact, expired: true }));
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([failedDetail.run]);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(failedDetail);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
    });

    const rerun = await view.findByRole("button", { name: "重跑失败任务" });
    expect(rerun).toBeDisabled();
    expect(view.getByText("已达到 50 次重跑上限")).toBeInTheDocument();
    const artifact = view.getByRole("button", { name: /dist/ });
    expect(artifact).toBeDisabled();
    expect(artifact).toHaveAttribute("title", "Artifact 已过期，无法读取");
  });

  it("Actions 筛选更新列表并写入路由", async () => {
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([
      githubWorkflowRuns[0],
      {
        ...githubWorkflowRuns[0],
        id: 1311,
        name: "Deploy",
        displayTitle: "feature deploy",
        status: "in_progress",
        conclusion: null,
        branch: "feature/actions",
        event: "push",
        updatedAt: "2026-06-18T09:00:00Z",
      },
    ]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
    });

    expect(await view.findByRole("button", { name: /feature deploy/ }, { timeout: 5000 })).toBeInTheDocument();
    await fireEvent.update(view.getByLabelText("搜索 Actions"), "feature");

    await waitFor(() => {
      expect(view.queryByRole("button", { name: /release pipeline/ })).toBeNull();
      expect(view.getByRole("button", { name: /feature deploy/ })).toBeInTheDocument();
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "actions",
        actionQ: "feature",
      });
    });
  });

  it("Actions 从路由恢复筛选，并在当前 run 被筛掉时清空右侧信息", async () => {
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([
      githubWorkflowRuns[0],
      {
        ...githubWorkflowRuns[0],
        id: 1311,
        name: "Deploy",
        displayTitle: "feature deploy",
        status: "in_progress",
        conclusion: null,
        branch: "feature/actions",
        event: "push",
        updatedAt: "2026-06-18T09:00:00Z",
      },
    ]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    }, "/repos/local-repo?projectTab=actions&actionState=active&actionQ=feature");

    expect(await view.findByRole("button", { name: /feature deploy/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(view.getByLabelText("搜索 Actions")).toHaveValue("feature");
    expect(view.queryByRole("button", { name: /release pipeline/ })).toBeNull();

    const actionFilters = await view.findByLabelText("Actions 筛选项");
    await fireEvent.click(within(actionFilters).getByRole("button", { name: "All" }));
    await fireEvent.update(view.getByLabelText("搜索 Actions"), "");
    const releaseRun = await view.findByRole("button", { name: /release pipeline/ });
    await fireEvent.click(releaseRun);
    expect(await view.findByRole("heading", { level: 3, name: "release pipeline" })).toBeInTheDocument();

    await fireEvent.update(view.getByLabelText("搜索 Actions"), "feature");
    await waitFor(() => {
      expect(view.getByLabelText("Actions 信息")).toHaveTextContent("选择一个 run 查看摘要和产物。");
      expect(view.router.currentRoute.value.query.run).toBeUndefined();
    });
  });

  it("Actions artifact 中的 Windows 安装包可直接附加到对应 draft release", async () => {
    const draftRelease: GitHubRelease = {
      ...githubReleases[0],
      id: 8003,
      tagName: "v1.2.0",
      name: "Lilia v1.2.0",
      draft: true,
      publishedAt: null,
      assets: [],
    };
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue(githubWorkflowRuns);
    vi.mocked(getGitHubWorkflowRunDetail).mockResolvedValue(githubWorkflowRunDetail);
    vi.mocked(listGitHubReleases).mockResolvedValue([draftRelease]);
    vi.mocked(listGitHubWorkflowArtifactFiles).mockResolvedValue([
      { path: "packages/Lilia_1.2.0_x64.msi", name: "Lilia_1.2.0_x64.msi", kind: "file", size: 4096 },
    ]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
      projectRunId: 1310,
    });

    expect(await view.findByRole("heading", { level: 3, name: "release pipeline" })).toBeInTheDocument();
    await fireEvent.click(await view.findByRole("button", { name: /dist/ }));
    const attachButton = await view.findByRole("button", { name: "附加 Lilia_1.2.0_x64.msi 到 draft release" });
    await waitFor(() => {
      expect(attachButton).not.toBeDisabled();
    });
    await fireEvent.click(attachButton);

    await waitFor(() => {
      expect(attachGitHubWorkflowArtifactAsset).toHaveBeenCalledWith("sena-nana/remote-repo", {
        runId: 1310,
        artifactId: 131001,
        artifactName: "dist",
        artifactPath: "packages/Lilia_1.2.0_x64.msi",
        releaseId: 8003,
        expectedTagName: "v1.2.0",
        label: "Windows",
      });
    });
  });

  it.each([
    {
      tabName: "Issues",
      fail: () => vi.mocked(listGitHubIssues).mockRejectedValueOnce(new Error("GitHub 绑定已失效，请重新绑定")),
      title: "Issues 暂不可用",
      reason: "GitHub 绑定已失效或凭据不可用，请重新绑定 GitHub 后继续使用。",
      hiddenText: "新建 Issue",
    },
    {
      tabName: "Pull Requests",
      fail: () => vi.mocked(listGitHubPullRequests).mockRejectedValueOnce(new Error("Bad credentials")),
      title: "Pull Requests 暂不可用",
      reason: "GitHub 绑定已失效或凭据不可用，请重新绑定 GitHub 后继续使用。",
      hiddenText: "新建 PR",
    },
    {
      tabName: "Actions",
      fail: () => vi.mocked(listGitHubWorkflowRuns).mockRejectedValueOnce(new Error("HTTP 403 Forbidden")),
      title: "Actions 暂不可用",
      reason: "当前 GitHub 授权权限不足，无法访问该仓库的 Actions。请重新绑定 GitHub 并授予所需权限。",
      hiddenText: "没有 GitHub Actions 运行记录。",
    },
    {
      tabName: "Settings",
      fail: () => vi.mocked(getGitHubRepoManagement)
        .mockRejectedValueOnce(new Error("HTTP 403 Resource not accessible by integration"))
        .mockRejectedValueOnce(new Error("HTTP 403 Resource not accessible by integration")),
      title: "Settings 暂不可用",
      reason: "当前 GitHub 授权权限不足，无法访问该仓库的 Settings。请重新绑定 GitHub 并授予所需权限。",
      hiddenText: "GitHub 功能",
    },
  ])("$tabName 因 GitHub 授权不可用时提供重新绑定入口", async ({ tabName, fail, title, reason, hiddenText }) => {
    fail();
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: tabName }));

    expect(await view.findByText(title)).toBeInTheDocument();
    expect(view.getByText(reason)).toBeInTheDocument();
    expect(view.queryByText(hiddenText)).toBeNull();

    await fireEvent.click(view.getByRole("button", { name: "重新绑定 GitHub" }));
    expect(startAuthFlow).toHaveBeenCalledTimes(1);
  });

  it("Pull Requests 分区按需加载列表，点击后进入详情并支持合并", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    vi.mocked(listGitHubPullRequestChecks).mockResolvedValue(githubPullRequestChecks);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    const pullGroup = view.getByLabelText("v1 Pull Requests");
    expect(pullGroup).toHaveTextContent("#52 接入 Pull Request 工作流");
    expect(pullGroup).not.toHaveTextContent("#12 修复懒加载");
    expect(pullGroup).toHaveAttribute("data-agent-id", "repo.pulls.group.milestone.1");
    expect(view.queryByRole("button", { name: "合并" })).toBeNull();
    expect(view.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(listGitHubPullRequests).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open", sort: "updated", direction: "desc" }),
    );
    expect(listGitHubPullRequestChecks).not.toHaveBeenCalled();

    await fireEvent.click(view.getByText("#52 接入 Pull Request 工作流"));
    expect(await view.findByRole("heading", { level: 3, name: "#52 接入 Pull Request 工作流" })).toBeInTheDocument();
    expect(await view.findByText("1 个 checks")).toBeInTheDocument();
    expect(view.getByText("ci / build")).toBeInTheDocument();
    expect(view.getByText("接入 PR 工作流。")).toBeInTheDocument();
    const pullSidebar = view.getByLabelText("Pull Requests 详情侧栏");
    expect(pullSidebar).toHaveTextContent("PR #52");
    expect(pullSidebar).toHaveTextContent("打开");
    expect(pullSidebar).toHaveTextContent("mika · 待审阅");
    expect(pullSidebar).toHaveTextContent("core · 团队 · 已通过");
    expect(pullSidebar).toHaveTextContent("sena");
    expect(pullSidebar).toHaveTextContent("bug");
    expect(pullSidebar).toHaveTextContent("Roadmap");
    expect(pullSidebar).toHaveTextContent("v1");
    expect(pullSidebar).toHaveTextContent("feature/pr-flow -> main");
    expect(pullSidebar).toHaveTextContent("可合并");
    expect(pullSidebar).toHaveTextContent("2 个 commits");
    expect(pullSidebar).toHaveTextContent("Issue #12 修复懒加载");
    expect(pullSidebar).toHaveTextContent("abcdef1 接入 PR 详情侧栏");
    expect(pullSidebar).not.toHaveTextContent("暂无审阅人");
    expect(view.queryByLabelText("Pull Request 筛选项")).toBeNull();
    expect(getGitHubPullRequestDiscussion).toHaveBeenCalledWith("sena-nana/remote-repo", 52);
    expect(listGitHubPullRequestChecks).toHaveBeenCalledWith("sena-nana/remote-repo", 52);
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({ projectTab: "pulls", pr: "52" });
    });
    await waitFor(() => {
      expect(view.queryByRole("button", { name: "刷新当前页" })).toBeNull();
    });
    await view.refreshCurrentPage();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "open", sort: "updated", direction: "desc" }),
        { forceRefresh: true },
      );
      expect(getGitHubPullRequestDiscussion).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        52,
        { forceRefresh: true },
      );
      expect(listGitHubPullRequestChecks).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        52,
        { forceRefresh: true },
      );
    });
    await fireEvent.click(view.getByRole("button", { name: "合并" }));
    await waitFor(() => {
      expect(mergeGitHubPullRequest).toHaveBeenCalledWith("sena-nana/remote-repo", 52, { method: "merge" });
    });
    await fireEvent.click(view.getByRole("button", { name: "Pull Requests" }));
    await waitFor(() => {
      expect(view.router.currentRoute.value.query.pr).toBeUndefined();
    });
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
  });

  it("PR review comment 优先跳转仓库文件预览并在预览失败时打开外链", async () => {
    const pullRequest = githubPullRequests[0];
    const reviewCommentUrl = "https://github.com/sena-nana/remote-repo/pull/52#discussion_r1";
    const reviewComment = {
      id: "pull-52-review-comment-1",
      kind: "reviewComment" as const,
      actor: "mika",
      body: "这里需要检查文件定位。",
      url: reviewCommentUrl,
      path: "src/components/repo/RepoProjectPanel.vue",
      line: 128,
      originalLine: 120,
      commitId: "abcdef1234567890",
      createdAt: "2026-06-18T08:01:00Z",
      updatedAt: "2026-06-18T08:01:00Z",
    };
    vi.mocked(listGitHubPullRequests).mockResolvedValue([pullRequest]);
    vi.mocked(getGitHubPullRequestDiscussion).mockResolvedValue({
      pullRequest,
      timeline: [
        {
          id: "pull-52-body",
          kind: "body",
          actor: pullRequest.author,
          body: pullRequest.body,
          url: pullRequest.htmlUrl,
          createdAt: pullRequest.createdAt,
          updatedAt: pullRequest.updatedAt,
        },
        reviewComment,
      ],
    });
    vi.mocked(getRepoFilePreview).mockImplementation(async (_repoId, path) => (
      filePreview(path, "one\ntwo\nthree\nfour")
    ));

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    await fireEvent.click(await view.findByText("#52 接入 Pull Request 工作流"));
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({ projectTab: "pulls", pr: "52" });
    });
    const reviewCommentMeta = await view.findByText(/src\/components\/repo\/RepoProjectPanel\.vue:128/);
    const reviewCommentEntry = reviewCommentMeta.closest(".discussion-timeline__entry") as HTMLElement;
    await fireEvent.click(within(reviewCommentEntry).getByRole("button", { name: "打开讨论项" }));
    expect(getRepoFilePreview).toHaveBeenCalledWith(
      "local-repo",
      "src/components/repo/RepoProjectPanel.vue",
    );

    await waitFor(() => {
      expect(view.router.currentRoute.value.fullPath).toBe(
        "/repos/local-repo/files?file=src/components/repo/RepoProjectPanel.vue&hash=L128",
      );
    });
    expect(openUrl).not.toHaveBeenCalledWith(reviewCommentUrl);
    view.unmount();

    vi.mocked(openUrl).mockClear();
    vi.mocked(getRepoFilePreview).mockRejectedValue(new Error("missing preview"));
    const fallbackView = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(fallbackView.getByRole("tab", { name: "Pull Requests" }));
    await fireEvent.click(await fallbackView.findByText("#52 接入 Pull Request 工作流"));
    await waitFor(() => {
      expect(fallbackView.router.currentRoute.value.query).toMatchObject({ projectTab: "pulls", pr: "52" });
    });
    const fallbackMeta = await fallbackView.findByText(/src\/components\/repo\/RepoProjectPanel\.vue:128/);
    const fallbackEntry = fallbackMeta.closest(".discussion-timeline__entry") as HTMLElement;
    await fireEvent.click(within(fallbackEntry).getByRole("button", { name: "打开讨论项" }));

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith(reviewCommentUrl);
    });
    expect(fallbackView.router.currentRoute.value.fullPath).not.toContain("/files");
  });

  it("Pull Requests 空元信息行使用共享列表布局并显示空态", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue([{
      ...githubPullRequests[0],
      number: 55,
      title: "无元数据 PR",
      labels: [],
      assignees: [],
      milestone: null,
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/55",
    }]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#55 无元数据 PR")).toBeInTheDocument();
    expect(view.getByLabelText("无里程碑 Pull Requests")).toHaveTextContent("#55 无元数据 PR");
    expect(view.getByText("无标签 · 未分配 · 无项目")).toBeInTheDocument();
  });

  it("Pull Requests 状态切换按 Open、Closed、Merged 刷新", async () => {
    const closedPull: GitHubPullRequest = {
      ...githubPullRequests[0],
      number: 53,
      title: "关闭未合并 PR",
      state: "closed",
      merged: false,
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/53",
    };
    const mergedPull: GitHubPullRequest = {
      ...githubPullRequests[0],
      number: 54,
      title: "已合并 PR",
      state: "closed",
      merged: true,
      htmlUrl: "https://github.com/sena-nana/remote-repo/pull/54",
    };
    vi.mocked(listGitHubPullRequests).mockImplementation(async (_repoFullName, options) => {
      const state = typeof options === "object" && options != null ? options.state : options;
      if (state === "closed") return [closedPull];
      if (state === "merged") return [mergedPull];
      return githubPullRequests;
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "open" }),
      );
    });

    await fireEvent.click(within(view.getByRole("group", { name: "Pull Request 状态" })).getByRole("button", { name: /Closed/ }));
    expect(await view.findByText("#53 关闭未合并 PR")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "closed", sort: "updated", direction: "desc" }),
      );
    });

    await fireEvent.click(within(view.getByRole("group", { name: "Pull Request 状态" })).getByRole("button", { name: /Merged/ }));
    expect(await view.findByText("#54 已合并 PR")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "merged", sort: "updated", direction: "desc" }),
      );
    });
  });

  it("Pull Requests 搜索、筛选和排序选择后立即传递请求参数", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();

    const projectSidebar = view.container.querySelector(".project-sidebar") as HTMLElement;
    expect(projectSidebar).toBeInTheDocument();
    const filters = within(projectSidebar).getByLabelText("Pull Request 筛选项");
    expect(view.container.querySelector(".project-main")?.querySelector("[aria-label='Pull Request 筛选项']")).toBeNull();

    await fireEvent.update(within(filters).getByLabelText("搜索 Pull Requests"), "workflow");
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ query: "workflow" }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "pulls",
        pullQ: "workflow",
      });
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意作者" }));
    await fireEvent.click(await view.findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ creator: "sena" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意标签" }));
    await fireEvent.click(await view.findByRole("option", { name: "bug" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ labels: ["bug"] }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意项目" }));
    await fireEvent.click(await view.findByRole("option", { name: "Roadmap" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ project: "PVT_kwDOIssue" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意里程碑" }));
    await fireEvent.click(await view.findByRole("option", { name: "v1" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ milestone: "1" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意 Review" }));
    await fireEvent.click(await view.findByRole("option", { name: "已批准" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ review: "approved" }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        pullReview: "approved",
      });
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意负责人" }));
    await fireEvent.click(await view.findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ assignee: "sena" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "最近更新" }));
    await fireEvent.click(await view.findByRole("option", { name: "评论最多" }));
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ sort: "comments", direction: "desc" }),
      );
    });
  });

  it("Pull Requests 筛选条件可从 URL 恢复", async () => {
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    const view = await renderProjectPanel(
      {
        repoFullName: "sena-nana/remote-repo",
        projectTab: "pulls",
      },
      [
        "/repos/local-repo?projectTab=pulls",
        "pullState=merged",
        "pullQ=workflow",
        "pullCreator=sena",
        "pullLabels=bug",
        "pullReview=approved",
        "pullSort=created",
        "pullDirection=asc",
      ].join("&"),
    );

    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    expect(view.getByLabelText("搜索 Pull Requests")).toHaveValue("workflow");
    expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({
        state: "merged",
        query: "workflow",
        creator: "sena",
        labels: ["bug"],
        review: "approved",
        sort: "created",
        direction: "asc",
      }),
    );
  });

  it("Issues 分区通过模板创建视图提交 Issue Form", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    vi.mocked(listGitHubRepoFiles).mockImplementation(async (_repoFullName, parentPath) => (
      parentPath === ".github/ISSUE_TEMPLATE"
        ? [repoFile(".github/ISSUE_TEMPLATE/bug_report.yml")]
        : []
    ));
    vi.mocked(getGitHubRepoFilePreview).mockResolvedValue(filePreview(
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      [
        "name: Bug report",
        "description: Report a bug",
        "title: \"[BUG] \"",
        "labels:",
        "  - bug",
        "  - needs triage",
        "body:",
        "  - type: input",
        "    id: summary",
        "    attributes:",
        "      label: Summary",
        "      placeholder: Broken behavior",
        "    validations:",
        "      required: true",
        "  - type: textarea",
        "    id: details",
        "    attributes:",
        "      label: Details",
        "  - type: dropdown",
        "    id: area",
        "    attributes:",
        "      label: Area",
        "      options:",
        "        - UI",
        "        - Backend",
      ].join("\n"),
    ));
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    await view.findByText("#12 修复懒加载");
    const projectSidebar = view.container.querySelector(".project-sidebar") as HTMLElement;
    await fireEvent.click(within(projectSidebar).getByRole("button", { name: "新建 Issue" }));

    const form = await view.findByRole("form", { name: "新建 Issue" });
    expect(view.queryByRole("heading", { level: 3, name: "Issues" })).toBeNull();
    await waitFor(() => {
      expect(getGitHubRepoFilePreview).toHaveBeenCalledWith("sena-nana/remote-repo", ".github/ISSUE_TEMPLATE/bug_report.yml");
    });
    await waitFor(() => {
      expect(listGitHubIssueLabels).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
      expect(listGitHubIssueAssignees).toHaveBeenCalledWith("sena-nana/remote-repo", { forceRefresh: false });
    });
    const issueTemplateButton = within(form).getByRole("button", { name: "空白 Issue" });
    await waitFor(() => expect(issueTemplateButton).not.toBeDisabled());
    await fireEvent.click(issueTemplateButton);
    await fireEvent.click(await view.findByRole("option", { name: /Bug report/ }, { timeout: 5000 }));
    await fireEvent.click(within(form).getByRole("button", { name: "未分配" }));
    await fireEvent.click(await view.findByRole("option", { name: /^sena$/ }));
    await fireEvent.update(within(form).getByLabelText("标题"), "[BUG] 模板创建");
    await fireEvent.update(within(form).getByLabelText("Summary*"), "点击按钮后没有进入创建页");
    await fireEvent.update(within(form).getByLabelText("Details"), "需要展示完整模板表单。");
    await fireEvent.click(within(form).getByRole("button", { name: "Area" }));
    await fireEvent.click(await view.findByRole("option", { name: /^UI$/ }));
    await fireEvent.click(within(form).getByRole("button", { name: "创建 Issue" }));

    await waitFor(() => {
      expect(createGitHubIssue).toHaveBeenCalledWith("sena-nana/remote-repo", {
        title: "[BUG] 模板创建",
        body: expect.stringContaining("### Summary\n\n点击按钮后没有进入创建页"),
        labels: ["bug", "needs triage"],
        assignees: ["sena"],
      });
    });
    expect(createGitHubIssue).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({
        body: expect.stringContaining("### Area\n\nUI"),
      }),
    );
    await waitFor(() => {
      expect(view.queryByRole("form", { name: "新建 Issue" })).toBeNull();
    });
  });

  it("Pull Requests 分区通过模板创建视图提交默认分支表单", async () => {
    state.repos = [repoSummary("local-repo", { currentBranch: "feature/template-create" })];
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    vi.mocked(listGitHubRepoFiles).mockImplementation(async (_repoFullName, parentPath) => (
      parentPath === ".github"
        ? [repoFile(".github/PULL_REQUEST_TEMPLATE.md")]
        : []
    ));
    vi.mocked(getGitHubRepoFilePreview).mockResolvedValue(filePreview(
      ".github/PULL_REQUEST_TEMPLATE.md",
      "## Summary\n\n- \n",
    ));
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    await view.findByText("#52 接入 Pull Request 工作流");
    const projectSidebar = view.container.querySelector(".project-sidebar") as HTMLElement;
    await fireEvent.click(within(projectSidebar).getByRole("button", { name: "新建 PR" }));

    const form = await view.findByRole("form", { name: "新建 PR" });
    expect(view.queryByRole("heading", { level: 3, name: "Pull Requests" })).toBeNull();
    await waitFor(() => {
      expect(getGitHubRepoFilePreview).toHaveBeenCalledWith("sena-nana/remote-repo", ".github/PULL_REQUEST_TEMPLATE.md");
    });
    const pullTemplateButton = within(form).getByRole("button", { name: "空白 PR" });
    await waitFor(() => expect(pullTemplateButton).not.toBeDisabled());
    await fireEvent.click(pullTemplateButton);
    await fireEvent.click(await view.findByRole("option", { name: /PULL REQUEST TEMPLATE/ }, { timeout: 5000 }));
    expect(within(form).getByLabelText("来源分支")).toHaveValue("feature/template-create");
    expect(within(form).getByLabelText("目标分支")).toHaveValue("main");

    await fireEvent.update(within(form).getByLabelText("标题"), "接入模板创建页");
    expect(within(form).getByLabelText("描述")).toHaveValue("## Summary\n\n- \n");
    await fireEvent.click(within(form).getByRole("button", { name: "创建 PR" }));

    await waitFor(() => {
      expect(createGitHubPullRequest).toHaveBeenCalledWith("sena-nana/remote-repo", {
        title: "接入模板创建页",
        body: "## Summary\n\n- \n",
        head: "feature/template-create",
        base: "main",
        draft: false,
      });
    });
    await waitFor(() => {
      expect(view.queryByRole("form", { name: "新建 PR" })).toBeNull();
    });
  });

  it("issues 过滤切换只触发一次刷新请求", async () => {
    vi.mocked(listGitHubIssues).mockImplementation(async (_repoFullName, options) => {
      const state = typeof options === "object" && options != null ? options.state : options;
      return state === "closed" ? closedGitHubIssues : githubIssues;
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "open" }),
      );
    });

    await fireEvent.click(within(view.getByRole("group", { name: "Issue 状态" })).getByRole("button", { name: /Closed/ }));
    expect(await view.findByText("#34 已关闭问题")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "closed", sort: "created", direction: "desc" }),
    );
  });

  it("Issues 使用账户默认值", async () => {
    state.settings = {
      ...workspaceSettings(),
      accountPreferences: {
        ...workspaceSettings().accountPreferences,
        issues: { state: "closed", sort: "updated", direction: "asc" },
      },
    };
    const defaultsView = await renderProjectPanel({ repoFullName: "sena-nana/remote-repo" });
    await fireEvent.click(defaultsView.getByRole("tab", { name: "Issues" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "closed", sort: "updated", direction: "asc" }),
      );
    });
  });

  it("Pull Requests 使用账户默认值", async () => {
    state.settings = {
      ...workspaceSettings(),
      accountPreferences: {
        ...workspaceSettings().accountPreferences,
        pullRequests: { state: "merged", sort: "comments", direction: "asc" },
      },
    };
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);

    await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "pulls",
    });

    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "merged", sort: "comments", direction: "asc" }),
      );
    });
  });

  it("Actions 使用账户默认值且 URL 查询参数优先", async () => {
    state.settings = {
      ...workspaceSettings(),
      accountPreferences: {
        ...workspaceSettings().accountPreferences,
        actions: { state: "completed", sort: "run-number", direction: "asc" },
      },
    };
    const activeRun = {
      ...githubWorkflowRuns[0],
      id: 1311,
      displayTitle: "feature deploy",
      status: "in_progress",
      conclusion: null,
    };
    vi.mocked(listGitHubWorkflowRuns).mockResolvedValue([githubWorkflowRuns[0], activeRun]);

    const defaultsView = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "actions",
    });
    expect(await defaultsView.findByRole("button", { name: /release pipeline/ })).toBeInTheDocument();
    expect(defaultsView.queryByRole("button", { name: /feature deploy/ })).toBeNull();
    expect(within(defaultsView.getByLabelText("Actions 状态")).getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
    expect(defaultsView.getByRole("button", { name: "Run 编号（升序）" })).toBeInTheDocument();
    defaultsView.unmount();

    const routedView = await renderProjectPanel(
      { repoFullName: "sena-nana/remote-repo", projectTab: "actions" },
      "/repos/local-repo?projectTab=actions&actionState=active&actionSort=created&actionDirection=desc",
    );
    expect(await routedView.findByRole("button", { name: /feature deploy/ })).toBeInTheDocument();
    expect(routedView.queryByRole("button", { name: /release pipeline/ })).toBeNull();
    expect(routedView.getByRole("button", { name: "最新创建" })).toBeInTheDocument();
  });

  it("Issues 搜索通过远程接口刷新列表", async () => {
    const docsIssue: GitHubIssue = {
      ...githubIssues[0],
      number: 44,
      title: "整理文档",
      labels: ["documentation"],
      projectItems: [],
      htmlUrl: "https://github.com/sena-nana/remote-repo/issues/44",
    };
    vi.mocked(listGitHubIssues)
      .mockResolvedValueOnce([githubIssues[0], docsIssue])
      .mockResolvedValueOnce([githubIssues[0]]);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.getByText("#44 整理文档")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenCalledTimes(1);

    const projectSidebar = view.container.querySelector(".project-sidebar") as HTMLElement;
    const filters = within(projectSidebar).getByLabelText("Issue 筛选项");
    expect(view.container.querySelector(".project-main")?.querySelector("[aria-label='Issue 筛选项']")).toBeNull();

    await fireEvent.update(within(filters).getByLabelText("搜索 Issues"), "Roadmap");

    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ query: "Roadmap" }),
      );
    });
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.queryByText("#44 整理文档")).toBeNull();
    expect(listGitHubIssues).toHaveBeenCalledTimes(2);
  });

  it("Issues 筛选和排序选择后立即传递请求参数", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    const projectSidebar = view.container.querySelector(".project-sidebar") as HTMLElement;
    const filters = within(projectSidebar).getByLabelText("Issue 筛选项");
    expect(view.container.querySelector(".project-main")?.querySelector("[aria-label='Issue 筛选项']")).toBeNull();

    await fireEvent.click(within(filters).getByRole("button", { name: "任意作者" }));
    await fireEvent.click(await view.findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ creator: "sena" }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query).toMatchObject({
        projectTab: "issues",
        issueCreator: "sena",
      });
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意标签" }));
    await fireEvent.click(await view.findByRole("option", { name: "bug" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ labels: ["bug"] }),
      );
    });
    await waitFor(() => {
      expect(view.router.currentRoute.value.query.issueLabels).toEqual(["bug"]);
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意项目" }));
    await fireEvent.click(await view.findByRole("option", { name: "Roadmap" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ project: "PVT_kwDOIssue" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意里程碑" }));
    await fireEvent.click(await view.findByRole("option", { name: "v1" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ milestone: "1" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "任意负责人" }));
    await fireEvent.click(await view.findByRole("option", { name: "sena" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ assignee: "sena" }),
      );
    });

    await fireEvent.click(within(filters).getByRole("button", { name: "最新创建" }));
    await fireEvent.click(await view.findByRole("option", { name: "评论最多" }));
    await waitFor(() => {
      expect(listGitHubIssues).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ sort: "comments", direction: "desc" }),
      );
    });
  });

  it("Issues 筛选条件可从 URL 恢复", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    const view = await renderProjectPanel(
      {
        repoFullName: "sena-nana/remote-repo",
        projectTab: "issues",
      },
      [
        "/repos/local-repo?projectTab=issues",
        "issueState=closed",
        "issueQ=Roadmap",
        "issueCreator=sena",
        "issueLabels=bug",
        "issueLabels=documentation",
        "issueSort=updated",
        "issueDirection=asc",
      ].join("&"),
    );

    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(view.getByLabelText("搜索 Issues")).toHaveValue("Roadmap");
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({
        state: "closed",
        query: "Roadmap",
        creator: "sena",
        labels: ["bug", "documentation"],
        sort: "updated",
        direction: "asc",
      }),
    );
  });

  it("页面刷新当前 Issues 列表、筛选元数据和已打开详情", async () => {
    const refreshedIssue = { ...githubIssues[0], title: "刷新后的 Issue", body: "刷新后的正文" };
    vi.mocked(listGitHubIssues).mockImplementation(async (_repoFullName, _options, fetchOptions) => {
      if (fetchOptions?.forceRefresh) {
        return [refreshedIssue];
      }
      return githubIssues;
    });
    vi.mocked(getGitHubIssueDiscussion).mockImplementation(async (_repoFullName, _issueNumber, fetchOptions) => {
      return issueDiscussion(fetchOptions?.forceRefresh ? refreshedIssue : githubIssues[0]);
    });
    const view = await renderProjectPanel(
      { repoFullName: "sena-nana/remote-repo" },
      "/repos/local-repo?projectTab=issues&issueQ=Roadmap",
    );

    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    await fireEvent.click(view.getByText("#12 修复懒加载"));
    expect(await view.findByRole("heading", { level: 3, name: "#12 修复懒加载" })).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open", query: "Roadmap", sort: "created", direction: "desc" }),
    );

    await view.refreshCurrentPage();

    expect(await view.findByRole("heading", { level: 3, name: "#12 刷新后的 Issue" })).toBeInTheDocument();
    expect(view.getByText("刷新后的正文", { exact: false })).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open", query: "Roadmap", sort: "created", direction: "desc" }),
      { forceRefresh: true },
    );
    expect(getGitHubIssueFilterMetadata).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      { forceRefresh: true },
    );
    expect(getGitHubIssueDiscussion).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      12,
      { forceRefresh: true },
    );
  });

  it("Issues 首次加载失败后可通过页面刷新重试", async () => {
    let shouldFail = true;
    vi.mocked(listGitHubIssues).mockImplementation(async () => {
      if (shouldFail) throw new Error("temporary issue failure");
      return githubIssues;
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "issues",
    });

    expect(await view.findByText(/temporary issue failure/)).toBeInTheDocument();
    shouldFail = false;
    await view.refreshCurrentPage();
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    expect(listGitHubIssues).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ state: "open" }),
      { forceRefresh: true },
    );
  });

  it("切换分区后页面刷新只更新当前 Pull Requests", async () => {
    vi.mocked(listGitHubIssues).mockResolvedValue(githubIssues);
    vi.mocked(listGitHubPullRequests).mockResolvedValue(githubPullRequests);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "issues",
    });

    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();
    await fireEvent.click(view.getByRole("tab", { name: "Pull Requests" }));
    expect(await view.findByText("#52 接入 Pull Request 工作流")).toBeInTheDocument();
    const issueRequestCount = vi.mocked(listGitHubIssues).mock.calls.length;

    await view.refreshCurrentPage();
    await waitFor(() => {
      expect(listGitHubPullRequests).toHaveBeenLastCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ state: "open" }),
        { forceRefresh: true },
      );
    });
    expect(listGitHubIssues).toHaveBeenCalledTimes(issueRequestCount);
  });

  it("创建 Issue 请求返回后不会插入已切换仓库的 Issues 列表", async () => {
    const createResult = deferred<GitHubIssue>();
    const nextRepoIssues: GitHubIssue[] = [{
      ...githubIssues[0],
      number: 77,
      title: "next repo issue",
      htmlUrl: "https://github.com/sena-nana/next-repo/issues/77",
    }];
    vi.mocked(listGitHubIssues).mockImplementation(async (repoFullName) => (
      repoFullName === "sena-nana/next-repo" ? nextRepoIssues : githubIssues
    ));
    vi.mocked(createGitHubIssue).mockReturnValue(createResult.promise);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "issues",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Issues" }));
    expect(await view.findByText("#12 修复懒加载")).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "新建 Issue" }));
    const form = await view.findByRole("form", { name: "新建 Issue" });
    await fireEvent.update(within(form).getByLabelText("标题"), "old repo created issue");
    await fireEvent.click(within(form).getByRole("button", { name: "创建 Issue" }));
    expect(createGitHubIssue).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ title: "old repo created issue" }),
    );

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "issues",
    });
    expect(await view.findByText("#77 next repo issue")).toBeInTheDocument();

    createResult.resolve({
      ...githubIssues[0],
      number: 88,
      title: "old repo created issue",
      htmlUrl: "https://github.com/sena-nana/remote-repo/issues/88",
    });

    await waitFor(() => {
      expect(view.getByText("#77 next repo issue")).toBeInTheDocument();
    });
    expect(view.queryByText("#88 old repo created issue")).toBeNull();
  });

  it("Settings 页面刷新管理信息、branches 和详情分区", async () => {
    const view = await renderProjectPanel(
      { repoFullName: "sena-nana/remote-repo" },
      "/repos/local-repo?projectTab=settings",
    );

    expect(await view.findByRole("region", { name: "Security" })).toBeInTheDocument();
    const initialBranchRequests = vi.mocked(listGitHubBranches).mock.calls.length;
    await view.refreshCurrentPage();

    expect(getGitHubRepoManagement).toHaveBeenLastCalledWith(
      "sena-nana/remote-repo",
      { forceRefresh: true },
    );
    expect(vi.mocked(listGitHubBranches).mock.calls.length).toBeGreaterThan(initialBranchRequests);
    expect(vi.mocked(getGitHubRepoSettingsSection).mock.calls.some((call) => (
      call[0] === "sena-nana/remote-repo" && call[2]?.forceRefresh === true
    ))).toBe(true);
  });

  it("linked worktree 在设置区显示删除工作树文案", async () => {
    state.repos = [
      repoSummary("local-repo", {
        worktree: {
          role: "linked",
          sharedRepoKey: "shared:repo",
          mainRepoId: "main-repo",
        },
      }),
    ];
    const view = await renderProjectPanel({ projectTab: "settings" });

    await waitFor(() => {
      expect(view.getByRole("button", { name: "删除工作树" })).toBeInTheDocument();
    });
    await fireEvent.click(view.getByRole("button", { name: "删除工作树" }));
    expect(await view.findByRole("dialog", { name: "删除工作树" })).toBeInTheDocument();
    expect(view.getByText(/从当前共享仓库移除工作树/)).toBeInTheDocument();
  });

  it("仓库设置分区展示并统一保存功能开关", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const accessCard = await view.findByRole("region", { name: "协作与访问" }, { timeout: 5000 });
    const featureCard = view.getByRole("region", { name: "GitHub 功能" });
    const mergeCard = view.getByRole("region", { name: "拉取请求与合并" });
    const dangerCard = view.getByRole("region", { name: "危险操作" });
    const settingsNav = view.getByRole("navigation", { name: "设置分类" });
    expect(within(settingsNav).getByRole("button", { name: "协作与访问" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "GitHub 功能" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "拉取请求与合并" })).toBeInTheDocument();
    expect(within(settingsNav).getByText("常规")).toBeInTheDocument();
    expect(within(settingsNav).getByText("仓库控制")).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Security" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Branches" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Rulesets" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Actions" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Environments" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Webhooks" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "Access" })).toBeInTheDocument();
    expect(within(settingsNav).getByRole("button", { name: "危险操作" })).toBeInTheDocument();
    expect(within(accessCard).getByRole("switch", { name: /模板仓库/ })).toBeInTheDocument();
    expect(within(accessCard).getByRole("switch", { name: /允许 Fork/ })).toBeInTheDocument();
    expect(within(accessCard).getByRole("switch", { name: /网页提交签署/ })).toBeInTheDocument();
    expect(within(accessCard).queryByRole("switch", { name: /Issues/ })).toBeNull();
    expect(within(featureCard).getByRole("switch", { name: /Issues/ })).toBeInTheDocument();
    expect(within(featureCard).getByRole("switch", { name: /Wiki/ })).toBeInTheDocument();
    expect(within(featureCard).getByRole("switch", { name: /项目看板/ })).toBeInTheDocument();
    expect(within(featureCard).getByRole("switch", { name: /讨论/ })).toBeInTheDocument();
    expect(within(featureCard).getByRole("switch", { name: /拉取请求/ })).toBeInTheDocument();
    expect(within(mergeCard).getByRole("switch", { name: /合并提交/ })).toBeInTheDocument();
    expect(within(mergeCard).getByRole("switch", { name: /Squash 合并/ })).toBeInTheDocument();
    expect(within(mergeCard).getByRole("switch", { name: /Rebase 合并/ })).toBeInTheDocument();
    expect(within(mergeCard).getByRole("switch", { name: /自动合并/ })).toBeInTheDocument();
    expect(within(mergeCard).getByRole("switch", { name: /合并后删分支/ })).toBeInTheDocument();
    expect(within(mergeCard).getByRole("switch", { name: /更新分支/ })).toBeInTheDocument();
    expect(within(dangerCard).getByLabelText("本地危险操作")).toBeInTheDocument();
    expect(within(dangerCard).getByLabelText("归档操作")).toBeInTheDocument();
    expect(within(dangerCard).getByLabelText("远端危险操作")).toBeInTheDocument();
    expect(await view.findByRole("region", { name: "Security" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "Branches" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "Rulesets" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "Actions" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "Environments" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "Webhooks" })).toBeInTheDocument();
    expect(view.getByRole("region", { name: "Access" })).toBeInTheDocument();
    const branchesSection = view.getByRole("region", { name: "Branches" });
    await waitFor(() => {
      expect(view.getByText("Secret scanning")).toBeInTheDocument();
      expect(within(branchesSection).getByText("feature/settings")).toBeInTheDocument();
      expect(view.getByText("production")).toBeInTheDocument();
      expect(view.getByText("Deploy")).toBeInTheDocument();
      expect(view.getByText("部署密钥")).toBeInTheDocument();
    });
    expect(view.queryByText(/\/repos\/\{owner\}\/\{repo\}/)).toBeNull();
    expect(view.queryByText(/allowed_actions/)).toBeNull();

    const wikiSwitch = within(featureCard).getByRole("switch", { name: /Wiki/ });
    await fireEvent.click(wikiSwitch);
    await fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        expect.objectContaining({ hasWiki: true }),
      );
    });
    expect(vi.mocked(updateGitHubRepoSettings).mock.calls[0][1]).not.toHaveProperty("defaultBranch");
  });

  it("读取并更新主要分支保护规则", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const branchesCard = await view.findByRole("region", { name: "Branches" });
    const approvals = await within(branchesCard).findByRole("spinbutton");
    const contexts = within(branchesCard).getByPlaceholderText("每行一个检查名称");
    expect(approvals).toHaveValue(1);
    expect(contexts).toHaveValue("CI");

    await fireEvent.update(approvals, "2");
    await fireEvent.click(within(branchesCard).getByRole("button", { name: "保存分支保护" }));

    await waitFor(() => {
      expect(updateGitHubBranchProtection).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        "main",
        expect.objectContaining({
          required_status_checks: expect.objectContaining({ strict: true, contexts: ["CI"] }),
          enforce_admins: true,
          required_pull_request_reviews: expect.objectContaining({
            required_approving_review_count: 2,
          }),
          restrictions: null,
          required_conversation_resolution: true,
        }),
      );
    });
  });

  it("未保护分支可从空配置创建保护规则", async () => {
    vi.mocked(getGitHubBranchProtection).mockImplementation(async (_repoFullName, branchName) => (
      branchName === "feature/settings" ? null : {
        required_status_checks: null,
        enforce_admins: false,
        required_pull_request_reviews: null,
        restrictions: null,
      }
    ));
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const branchesCard = await view.findByRole("region", { name: "Branches" });
    await fireEvent.click(await within(branchesCard).findByRole("button", { name: "配置" }));
    await waitFor(() => {
      expect(within(branchesCard).getByText("尚未设置保护")).toBeInTheDocument();
    });
    await fireEvent.click(within(branchesCard).getByRole("switch", { name: "Pull Request 审批" }));
    await fireEvent.update(within(branchesCard).getByRole("spinbutton"), "1");
    await fireEvent.click(within(branchesCard).getByRole("button", { name: "保存分支保护" }));

    await waitFor(() => {
      expect(updateGitHubBranchProtection).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        "feature/settings",
        expect.objectContaining({
          required_pull_request_reviews: expect.objectContaining({
            required_approving_review_count: 1,
          }),
        }),
      );
    });
  });

  it("规则集更新保留未知规则并省略不可见的 bypass actors", async () => {
    const rules = [
      { type: "pull_request", parameters: { required_approving_review_count: 2 } },
      { type: "future_rule", parameters: { keep: "opaque" } },
    ];
    const ruleset = {
      id: 41,
      name: "Protect main",
      target: "branch",
      enforcement: "active",
      source_type: "Repository",
      source: "sena-nana/remote-repo",
      conditions: {
        ref_name: { include: ["~DEFAULT_BRANCH"], exclude: ["refs/heads/release/*"] },
        repository_name: { include: ["remote-repo"], exclude: [], protected: true },
      },
      rules,
    };
    vi.mocked(listGitHubRepoRulesets).mockResolvedValue([{
      id: 41,
      name: "Protect main",
      target: "branch",
      enforcement: "active",
      sourceType: "Repository",
      source: "sena-nana/remote-repo",
      repositoryOwned: true,
    }]);
    vi.mocked(getGitHubRepoRuleset).mockResolvedValue(ruleset);
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const rulesCard = await view.findByRole("region", { name: "Rulesets" });
    const name = await within(rulesCard).findByRole("textbox", { name: "名称" });
    expect(within(rulesCard).getByText("2 条，保存时保持不变")).toBeInTheDocument();
    await fireEvent.update(name, "Protect main updated");
    await fireEvent.click(within(rulesCard).getByRole("button", { name: "保存规则集" }));

    await waitFor(() => {
      expect(updateGitHubRepoRuleset).toHaveBeenCalledWith(
        "sena-nana/remote-repo",
        41,
        expect.objectContaining({
          name: "Protect main updated",
          target: "branch",
          enforcement: "active",
          conditions: ruleset.conditions,
          rules,
        }),
      );
    });
    expect(vi.mocked(updateGitHubRepoRuleset).mock.calls[0][2]).not.toHaveProperty("bypass_actors");
  });

  it("权限不足时保留保护与规则集摘要并禁用写入", async () => {
    vi.mocked(getGitHubRepoManagement).mockResolvedValue({
      ...githubSettings,
      viewerCanAdminister: false,
    });
    vi.mocked(listGitHubRepoRulesets).mockResolvedValue([{
      id: 42,
      name: "Organization baseline",
      target: "branch",
      enforcement: "active",
      sourceType: "Organization",
      source: "sena-nana",
      repositoryOwned: false,
    }]);
    vi.mocked(getGitHubRepoRuleset).mockResolvedValue({
      id: 42,
      name: "Organization baseline",
      target: "branch",
      enforcement: "active",
      source_type: "Organization",
      source: "sena-nana",
      conditions: { ref_name: { include: ["~ALL"], exclude: [] } },
      rules: [{ type: "deletion" }],
    });
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const branchesCard = await view.findByRole("region", { name: "Branches" });
    const rulesCard = view.getByRole("region", { name: "Rulesets" });
    expect(await within(branchesCard).findByText("当前账号没有仓库管理权限，分支保护以只读方式显示。")).toBeInTheDocument();
    expect(within(branchesCard).getByRole("spinbutton")).toBeDisabled();
    expect((await within(rulesCard).findAllByText("Organization baseline")).length).toBeGreaterThanOrEqual(2);
    expect(await within(rulesCard).findByText("此规则集由上级范围提供，只能在来源位置修改。")).toBeInTheDocument();
    expect(within(rulesCard).getByRole("textbox", { name: "名称" })).toBeDisabled();
    expect(within(branchesCard).queryByRole("button", { name: "保存分支保护" })).toBeNull();
    expect(within(rulesCard).queryByRole("button", { name: "保存规则集" })).toBeNull();
  });

  it("分支保护写入失败时保留草稿并进入明确只读降级", async () => {
    vi.mocked(updateGitHubBranchProtection).mockRejectedValue(new Error("HTTP 403 Forbidden"));
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const branchesCard = await view.findByRole("region", { name: "Branches" });
    const approvals = await within(branchesCard).findByRole("spinbutton");
    await fireEvent.update(approvals, "3");
    await fireEvent.click(within(branchesCard).getByRole("button", { name: "保存分支保护" }));

    expect(await within(branchesCard).findByText("保存分支保护失败：当前凭据权限不足。")).toBeInTheDocument();
    expect(within(branchesCard).getByText("当前凭据没有修改分支保护的权限。")).toBeInTheDocument();
    expect(approvals).toHaveValue(3);
    expect(approvals).toBeDisabled();
    expect(updateGitHubBranchProtection).toHaveBeenCalledTimes(1);
    expect(getGitHubBranchProtection).toHaveBeenCalledTimes(1);
  });

  it("归档仓库需要完整仓库名确认并走独立 mutation", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const dangerCard = await view.findByRole("region", { name: "危险操作" });
    await fireEvent.click(within(dangerCard).getByRole("button", { name: "归档" }));

    const dialog = await view.findByRole("dialog", { name: "归档 GitHub 仓库" });
    expect(within(dialog).getByRole("button", { name: /确认归档/ })).toBeDisabled();
    await fireEvent.update(within(dialog).getByLabelText("输入完整仓库名以确认"), "sena-nana/remote-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: /确认归档/ }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith("sena-nana/remote-repo", { archived: true });
    });
  });

  it("关闭安全能力需要完整仓库名确认", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const securityCard = await view.findByRole("region", { name: "Security" });
    await waitFor(() => {
      expect(within(securityCard).getByRole("switch", { name: "Secret scanning" })).toBeInTheDocument();
    });
    await fireEvent.click(within(securityCard).getByRole("switch", { name: "Secret scanning" }));

    const dialog = await view.findByRole("dialog", { name: "关闭安全能力" });
    expect(within(dialog).getByRole("button", { name: "确认关闭" })).toBeDisabled();
    await fireEvent.update(within(dialog).getByLabelText("输入 sena-nana/remote-repo 以确认"), "sena-nana/remote-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认关闭" }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith("sena-nana/remote-repo", {
        securityAndAnalysis: expect.objectContaining({
          secret_scanning: expect.objectContaining({ status: "disabled" }),
        }),
      });
    });
  });

  it("关闭 Actions 需要完整仓库名确认并调用权限命令", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const actionsCard = await view.findByRole("region", { name: "Actions" });
    await waitFor(() => {
      expect(within(actionsCard).getByRole("switch", { name: "Actions" })).toBeInTheDocument();
    });
    await fireEvent.click(within(actionsCard).getByRole("switch", { name: "Actions" }));

    const dialog = await view.findByRole("dialog", { name: "关闭 Actions" });
    expect(within(dialog).getByRole("button", { name: "确认关闭" })).toBeDisabled();
    await fireEvent.update(within(dialog).getByLabelText("输入 sena-nana/remote-repo 以确认"), "sena-nana/remote-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认关闭" }));

    await waitFor(() => {
      expect(updateGitHubRepoActionsPermissions).toHaveBeenCalledWith("sena-nana/remote-repo", {
        enabled: false,
        allowedActions: "all",
        shaPinningRequired: false,
      });
    });
  });

  it("删除远端分支需要输入分支名确认", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));

    const branchesCard = await view.findByRole("region", { name: "Branches" });
    await waitFor(() => {
      expect(within(branchesCard).getByRole("button", { name: "删除 feature/settings" })).toBeInTheDocument();
    });
    expect(within(branchesCard).queryByRole("button", { name: "删除 main" })).toBeNull();
    await fireEvent.click(within(branchesCard).getByRole("button", { name: "删除 feature/settings" }));

    const dialog = await view.findByRole("dialog", { name: "删除远端分支" });
    expect(within(dialog).getByRole("button", { name: "确认删除" })).toBeDisabled();
    await fireEvent.update(within(dialog).getByLabelText("输入 feature/settings 以确认"), "feature/settings");
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(deleteGitHubBranch).toHaveBeenCalledWith("sena-nana/remote-repo", "feature/settings");
    });
  });

  it("保存设置请求返回后不会覆盖已切换仓库的设置状态", async () => {
    const saveResult = deferred<GitHubRepoManagement>();
    const nextSettings = {
      ...githubSettings,
      fullName: "sena-nana/next-repo",
      name: "next-repo",
      description: "Next repository tools",
      htmlUrl: "https://github.com/sena-nana/next-repo",
    };
    vi.mocked(getGitHubRepoManagement).mockImplementation(async (repoFullName) => (
      repoFullName === "sena-nana/next-repo" ? nextSettings : githubSettings
    ));
    vi.mocked(updateGitHubRepoSettings).mockReturnValue(saveResult.promise);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(await view.findByRole("switch", { name: /Wiki/ }, { timeout: 5000 })).not.toBeChecked();

    await fireEvent.click(view.getByRole("switch", { name: /Wiki/ }));
    await fireEvent.click(view.getByRole("button", { name: "保存" }));
    expect(updateGitHubRepoSettings).toHaveBeenCalledWith(
      "sena-nana/remote-repo",
      expect.objectContaining({ hasWiki: true }),
    );

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "settings",
    });
    await waitFor(() => {
      expect(view.getByRole("switch", { name: /Wiki/ })).not.toBeChecked();
    });

    saveResult.resolve({
      ...githubSettings,
      description: "Old saved description",
      hasWiki: true,
    });

    await waitFor(() => {
      expect(view.getByRole("switch", { name: /Wiki/ })).not.toBeChecked();
    });
    expect(view.queryByText("Old saved description")).toBeNull();
  });

  it("删除远端仓库请求返回后不会标记已切换仓库为删除状态", async () => {
    const deleteResult = deferred<void>();
    const nextSettings = {
      ...githubSettings,
      fullName: "sena-nana/next-repo",
      name: "next-repo",
      description: "Next repository tools",
      htmlUrl: "https://github.com/sena-nana/next-repo",
    };
    vi.mocked(getGitHubRepoManagement).mockImplementation(async (repoFullName) => (
      repoFullName === "sena-nana/next-repo" ? nextSettings : githubSettings
    ));
    vi.mocked(deleteGitHubRepo).mockReturnValue(deleteResult.promise);

    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
      projectTab: "settings",
    });
    await fireEvent.click(view.getByRole("tab", { name: "Settings" }));
    expect(await view.findByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    expect(await view.findByRole("button", { name: "删除仓库" }, { timeout: 5000 })).toBeInTheDocument();

    await fireEvent.click(view.getByRole("button", { name: "删除仓库" }));
    const dialog = await view.findByRole("dialog", { name: "删除 GitHub 仓库" });
    await fireEvent.update(within(dialog).getByPlaceholderText("sena-nana/remote-repo"), "sena-nana/remote-repo");
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
    expect(deleteGitHubRepo).toHaveBeenCalledWith("sena-nana/remote-repo");

    await view.rerender({
      repoFullName: "sena-nana/next-repo",
      projectTab: "settings",
    });
    await waitFor(() => {
      expect(view.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    });

    deleteResult.resolve();

    await waitFor(() => {
      expect(view.getByRole("navigation", { name: "设置分类" })).toBeInTheDocument();
    });
    expect(view.queryByText("GitHub 远端仓库已删除，本地目录仍保留。")).toBeNull();
  });

  it("描述卡片支持编辑描述、homepage 和 topics", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    expect(await view.findByText("Remote repository tools")).toBeInTheDocument();
    await fireEvent.click(view.getByRole("button", { name: "编辑仓库描述" }));
    await fireEvent.update(view.getByPlaceholderText("Description"), "Updated description");
    await fireEvent.update(view.getByPlaceholderText("Homepage"), "https://example.com/new");
    const topicInput = view.getByPlaceholderText("Add topics");
    await fireEvent.update(topicInput, "Vue, codex");
    await fireEvent.keyDown(topicInput, { key: "Enter" });
    await fireEvent.click(view.getByRole("button", { name: "移除 tauri" }));
    await fireEvent.click(view.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateGitHubRepoSettings).toHaveBeenCalledWith("sena-nana/remote-repo", {
        description: "Updated description",
        homepage: "https://example.com/new",
        topics: ["vue", "codex"],
      });
    });
  });

  it("topics 编辑支持逗号拆分、退格删除和取消恢复", async () => {
    const view = await renderProjectPanel({
      repoFullName: "sena-nana/remote-repo",
    });

    await view.findByText("Remote repository tools");
    await fireEvent.click(view.getByRole("button", { name: "编辑仓库描述" }));
    const topicInput = view.getByPlaceholderText("Add topics");
    await fireEvent.update(topicInput, "Docs, docs api");
    await fireEvent.keyDown(topicInput, { key: "," });
    expect(view.getByRole("button", { name: "移除 docs" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "移除 api" })).toBeInTheDocument();
    await fireEvent.keyDown(topicInput, { key: "Backspace" });
    expect(view.queryByRole("button", { name: "移除 api" })).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "取消" }));

    expect(view.queryByRole("button", { name: "移除 docs" })).toBeNull();
    expect(within(view.getByLabelText("Topics")).getByText("tauri")).toBeInTheDocument();
  });
});
