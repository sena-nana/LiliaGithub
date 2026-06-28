import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankIssueTemplate,
  blankPullRequestTemplate,
  buildIssueTemplateBody,
  createIssueTemplateAnswers,
  issueTemplateRequiredFieldsSatisfied,
  loadGitHubIssueTemplates,
  parseGitHubIssueTemplate,
  parseGitHubPullRequestTemplate,
} from "../src/utils/githubTemplates";
import type { RepoFilePreview, RepoFileTreeEntry } from "../src/services/workspace/types";

describe("githubTemplates", () => {
  it("parses GitHub Issue Form YAML templates", () => {
    const content = readFileSync(resolve(".github/ISSUE_TEMPLATE/bug_report.yml"), "utf-8");
    const template = parseGitHubIssueTemplate(".github/ISSUE_TEMPLATE/bug_report.yml", content);

    expect(template).toMatchObject({
      kind: "form",
      name: "BUG",
      titlePrefix: "[BUG] ",
      labels: ["bug", "needs triage"],
    });
    const answers = createIssueTemplateAnswers(template!);
    expect(issueTemplateRequiredFieldsSatisfied(template!, answers)).toBe(false);
    answers.problem = "启动后无法加载仓库";
    answers.done = "看到项目列表";
    expect(buildIssueTemplateBody(template!, answers, "")).toContain("启动后无法加载仓库");
  });

  it("serializes Issue Form answers into markdown body", () => {
    const content = readFileSync(resolve(".github/ISSUE_TEMPLATE/feature_request.yml"), "utf-8");
    const template = parseGitHubIssueTemplate(".github/ISSUE_TEMPLATE/feature_request.yml", content)!;
    const answers = createIssueTemplateAnswers(template);
    answers.task = "新增模板创建页";
    answers.area = "桌面端界面";

    expect(issueTemplateRequiredFieldsSatisfied(template, answers)).toBe(true);
    expect(buildIssueTemplateBody(template, answers, "")).toContain("### 要做什么\n\n新增模板创建页");
    expect(buildIssueTemplateBody(template, answers, "")).toContain("### 影响范围\n\n桌面端界面");
  });

  it("uses markdown templates as body prefills", () => {
    const issue = parseGitHubIssueTemplate(".github/ISSUE_TEMPLATE.md", "## Context\n")!;
    const pull = parseGitHubPullRequestTemplate(".github/PULL_REQUEST_TEMPLATE.md", "## Summary\n")!;

    expect(issue).toMatchObject({ kind: "markdown", body: "## Context\n" });
    expect(pull).toMatchObject({ kind: "markdown", body: "## Summary\n" });
    expect(blankIssueTemplate().body).toBe("");
    expect(blankPullRequestTemplate().body).toBe("");
  });

  it("skips unreadable or non-text templates while keeping blank creation available", async () => {
    const files: RepoFileTreeEntry[] = [
      { path: ".github/ISSUE_TEMPLATE/bug.yml", name: "bug.yml", kind: "file", hasChildren: false },
      { path: ".github/ISSUE_TEMPLATE/binary.yml", name: "binary.yml", kind: "file", hasChildren: false },
    ];
    const previews: Record<string, RepoFilePreview> = {
      ".github/ISSUE_TEMPLATE/bug.yml": {
        path: ".github/ISSUE_TEMPLATE/bug.yml",
        name: "bug.yml",
        previewKind: "text",
        content: "name: Bug\nbody: []\n",
        size: 20,
        truncated: false,
      },
      ".github/ISSUE_TEMPLATE/binary.yml": {
        path: ".github/ISSUE_TEMPLATE/binary.yml",
        name: "binary.yml",
        previewKind: "binary",
        size: 20,
        truncated: false,
      },
    };

    const templates = await loadGitHubIssueTemplates("sena-nana/repo", {
      listFiles: async (_repoFullName, parentPath) => parentPath === ".github/ISSUE_TEMPLATE" ? files : [],
      previewFile: async (_repoFullName, path) => previews[path],
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("Bug");
  });
});
