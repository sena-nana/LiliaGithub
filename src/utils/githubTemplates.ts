import { parse as parseYaml } from "yaml";
import {
  getGitHubRepoFilePreview,
  listGitHubRepoFiles,
} from "../services/workspace/client";
import type { RepoFilePreview, RepoFileTreeEntry } from "../services/workspace/types";

export type GitHubIssueTemplateField =
  | {
    type: "markdown";
    id: string;
    label: string;
    value: string;
  }
  | {
    type: "input" | "textarea";
    id: string;
    label: string;
    description: string;
    placeholder: string;
    value: string;
    required: boolean;
    render: string | null;
  }
  | {
    type: "dropdown";
    id: string;
    label: string;
    description: string;
    options: string[];
    value: string;
    required: boolean;
  }
  | {
    type: "checkboxes";
    id: string;
    label: string;
    description: string;
    options: GitHubIssueTemplateCheckboxOption[];
    required: boolean;
  };

export type GitHubIssueTemplateCheckboxOption = {
  label: string;
  required: boolean;
};

export type GitHubIssueTemplate = {
  key: string;
  kind: "blank" | "markdown" | "form";
  name: string;
  description: string;
  path: string | null;
  titlePrefix: string;
  labels: string[];
  assignees: string[];
  body: string;
  fields: GitHubIssueTemplateField[];
};

export type GitHubPullRequestTemplate = {
  key: string;
  kind: "blank" | "markdown";
  name: string;
  description: string;
  path: string | null;
  body: string;
};

export type GitHubIssueTemplateAnswers = Record<string, string | string[]>;

type GitHubTemplateListFiles = typeof listGitHubRepoFiles;
type GitHubTemplatePreviewFile = typeof getGitHubRepoFilePreview;

export type GitHubTemplateLoader = {
  listFiles?: GitHubTemplateListFiles;
  previewFile?: GitHubTemplatePreviewFile;
};

const ISSUE_TEMPLATE_DIR = ".github/ISSUE_TEMPLATE";
const BLANK_ISSUE_KEY = "__blank_issue__";
const BLANK_PULL_REQUEST_KEY = "__blank_pull_request__";

export function blankIssueTemplate(): GitHubIssueTemplate {
  return {
    key: BLANK_ISSUE_KEY,
    kind: "blank",
    name: "空白 Issue",
    description: "不使用模板创建 Issue。",
    path: null,
    titlePrefix: "",
    labels: [],
    assignees: [],
    body: "",
    fields: [],
  };
}

export function blankPullRequestTemplate(): GitHubPullRequestTemplate {
  return {
    key: BLANK_PULL_REQUEST_KEY,
    kind: "blank",
    name: "空白 PR",
    description: "不使用模板创建 PR。",
    path: null,
    body: "",
  };
}

export async function loadGitHubIssueTemplates(
  repoFullName: string,
  loader: GitHubTemplateLoader = {},
): Promise<GitHubIssueTemplate[]> {
  const listFiles = loader.listFiles ?? listGitHubRepoFiles;
  const previewFile = loader.previewFile ?? getGitHubRepoFilePreview;
  const candidates = uniqueByPath([
    ...issueTemplateCandidatesFromEntries(await safeListFiles(listFiles, repoFullName, ISSUE_TEMPLATE_DIR)),
    ...issueTemplateCandidatesFromEntries(await safeListFiles(listFiles, repoFullName, ".github")),
  ]);

  const templates = await Promise.all(
    candidates.map(async (entry) => {
      const preview = await safePreviewFile(previewFile, repoFullName, entry.path);
      if (!preview || !isTextTemplatePreview(preview)) return null;
      return parseGitHubIssueTemplate(entry.path, preview.content ?? "");
    }),
  );
  return templates.filter((template): template is GitHubIssueTemplate => Boolean(template));
}

export async function loadGitHubPullRequestTemplates(
  repoFullName: string,
  loader: GitHubTemplateLoader = {},
): Promise<GitHubPullRequestTemplate[]> {
  const listFiles = loader.listFiles ?? listGitHubRepoFiles;
  const previewFile = loader.previewFile ?? getGitHubRepoFilePreview;
  const candidates = uniqueByPath([
    ...pullRequestTemplateCandidatesFromEntries(await safeListFiles(listFiles, repoFullName, null)),
    ...pullRequestTemplateCandidatesFromEntries(await safeListFiles(listFiles, repoFullName, ".github")),
    ...pullRequestTemplateCandidatesFromEntries(await safeListFiles(listFiles, repoFullName, "docs")),
    ...pullRequestTemplateCandidatesFromEntries(await safeListFiles(listFiles, repoFullName, ".github/PULL_REQUEST_TEMPLATE")),
  ]);

  const templates = await Promise.all(
    candidates.map(async (entry) => {
      const preview = await safePreviewFile(previewFile, repoFullName, entry.path);
      if (!preview || !isTextTemplatePreview(preview)) return null;
      return parseGitHubPullRequestTemplate(entry.path, preview.content ?? "");
    }),
  );
  return templates.filter((template): template is GitHubPullRequestTemplate => Boolean(template));
}

export function parseGitHubIssueTemplate(path: string, content: string): GitHubIssueTemplate | null {
  const normalizedPath = normalizeTemplatePath(path);
  if (isIssueFormTemplatePath(normalizedPath)) {
    return parseGitHubIssueFormTemplate(normalizedPath, content);
  }
  if (isMarkdownTemplatePath(normalizedPath)) {
    return {
      key: normalizedPath,
      kind: "markdown",
      name: templateNameFromPath(normalizedPath),
      description: normalizedPath,
      path: normalizedPath,
      titlePrefix: "",
      labels: [],
      assignees: [],
      body: content,
      fields: [],
    };
  }
  return null;
}

export function parseGitHubPullRequestTemplate(path: string, content: string): GitHubPullRequestTemplate | null {
  const normalizedPath = normalizeTemplatePath(path);
  if (!isMarkdownTemplatePath(normalizedPath)) return null;
  return {
    key: normalizedPath,
    kind: "markdown",
    name: templateNameFromPath(normalizedPath),
    description: normalizedPath,
    path: normalizedPath,
    body: content,
  };
}

export function createIssueTemplateAnswers(template: GitHubIssueTemplate): GitHubIssueTemplateAnswers {
  return Object.fromEntries(
    template.fields
      .filter((field) => field.type !== "markdown")
      .map((field) => {
        if (field.type === "checkboxes") return [field.id, []];
        return [field.id, field.value];
      }),
  );
}

export function issueTemplateRequiredFieldsSatisfied(
  template: GitHubIssueTemplate,
  answers: GitHubIssueTemplateAnswers,
): boolean {
  return template.fields.every((field) => {
    if (field.type === "markdown") return true;
    if (field.type === "checkboxes") {
      const checked = fieldAnswerList(answers[field.id]);
      if (field.required && checked.length === 0) return false;
      return field.options.every((option) => !option.required || checked.includes(option.label));
    }
    if (!field.required) return true;
    return fieldAnswerText(answers[field.id]).trim().length > 0;
  });
}

export function buildIssueTemplateBody(
  template: GitHubIssueTemplate,
  answers: GitHubIssueTemplateAnswers,
  markdownBody: string,
): string {
  if (template.kind !== "form") return markdownBody;
  const sections = template.fields.flatMap((field) => {
    if (field.type === "markdown") return [];
    if (field.type === "checkboxes") {
      const checked = fieldAnswerList(answers[field.id]);
      const value = field.options
        .map((option) => `- [${checked.includes(option.label) ? "x" : " "}] ${option.label}`)
        .join("\n");
      return value.trim() ? [`### ${field.label}\n\n${value}`] : [];
    }
    const value = fieldAnswerText(answers[field.id]).trim();
    if (!value) return [];
    if (field.type === "textarea" && field.render) {
      return [`### ${field.label}\n\n\`\`\`${field.render}\n${value}\n\`\`\``];
    }
    return [`### ${field.label}\n\n${value}`];
  });
  return sections.join("\n\n");
}

function parseGitHubIssueFormTemplate(path: string, content: string): GitHubIssueTemplate | null {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  return {
    key: path,
    kind: "form",
    name: readString(raw.name) || templateNameFromPath(path),
    description: readString(raw.description) || path,
    path,
    titlePrefix: readString(raw.title),
    labels: readStringList(raw.labels),
    assignees: readStringList(raw.assignees),
    body: "",
    fields: readIssueFormFields(raw.body),
  };
}

function readIssueFormFields(value: unknown): GitHubIssueTemplateField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<GitHubIssueTemplateField>((item, index) => {
    if (!isRecord(item)) return [];
    const type = readString(item.type);
    const attributes = isRecord(item.attributes) ? item.attributes : {};
    const validations = isRecord(item.validations) ? item.validations : {};
    const id = readString(item.id) || `${type || "field"}-${index}`;
    const label = readString(attributes.label) || readString(attributes.value) || id;
    if (type === "markdown") {
      return [{
        type,
        id,
        label,
        value: readString(attributes.value),
      }];
    }
    if (type === "input" || type === "textarea") {
      return [{
        type,
        id,
        label,
        description: readString(attributes.description),
        placeholder: readString(attributes.placeholder),
        value: readString(attributes.value),
        required: validations.required === true,
        render: readString(attributes.render) || null,
      }];
    }
    if (type === "dropdown") {
      return [{
        type,
        id,
        label,
        description: readString(attributes.description),
        options: readStringList(attributes.options),
        value: "",
        required: validations.required === true,
      }];
    }
    if (type === "checkboxes") {
      return [{
        type,
        id,
        label,
        description: readString(attributes.description),
        options: readCheckboxOptions(attributes.options),
        required: validations.required === true,
      }];
    }
    return [];
  });
}

function readCheckboxOptions(value: unknown): GitHubIssueTemplateCheckboxOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ label: item, required: false }];
    if (!isRecord(item)) return [];
    const label = readString(item.label);
    if (!label) return [];
    return [{ label, required: item.required === true }];
  });
}

function issueTemplateCandidatesFromEntries(entries: RepoFileTreeEntry[]) {
  return entries.filter((entry) => {
    const path = normalizeTemplatePath(entry.path);
    if (entry.kind !== "file") return false;
    if (path.toLowerCase() === `${ISSUE_TEMPLATE_DIR.toLowerCase()}/config.yml`) return false;
    return path === ".github/ISSUE_TEMPLATE.md" ||
      path.startsWith(`${ISSUE_TEMPLATE_DIR}/`) &&
        (isIssueFormTemplatePath(path) || isMarkdownTemplatePath(path));
  });
}

function pullRequestTemplateCandidatesFromEntries(entries: RepoFileTreeEntry[]) {
  return entries.filter((entry) => {
    const path = normalizeTemplatePath(entry.path);
    if (entry.kind !== "file" || !isMarkdownTemplatePath(path)) return false;
    return path === "PULL_REQUEST_TEMPLATE.md" ||
      path === ".github/PULL_REQUEST_TEMPLATE.md" ||
      path === "docs/PULL_REQUEST_TEMPLATE.md" ||
      path.startsWith(".github/PULL_REQUEST_TEMPLATE/");
  });
}

function isIssueFormTemplatePath(path: string) {
  return path.toLowerCase().endsWith(".yml") || path.toLowerCase().endsWith(".yaml");
}

function isMarkdownTemplatePath(path: string) {
  return path.toLowerCase().endsWith(".md");
}

function isTextTemplatePreview(preview: RepoFilePreview) {
  return !preview.truncated &&
    Boolean(preview.content) &&
    (preview.previewKind === "text" || preview.previewKind === "markdown");
}

async function safeListFiles(
  listFiles: GitHubTemplateListFiles,
  repoFullName: string,
  parentPath: string | null,
) {
  try {
    return await listFiles(repoFullName, parentPath);
  } catch {
    return [];
  }
}

async function safePreviewFile(
  previewFile: GitHubTemplatePreviewFile,
  repoFullName: string,
  path: string,
) {
  try {
    return await previewFile(repoFullName, path);
  } catch {
    return null;
  }
}

function uniqueByPath(entries: RepoFileTreeEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const path = normalizeTemplatePath(entry.path);
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function normalizeTemplatePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function templateNameFromPath(path: string) {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(md|ya?ml)$/i, "").replace(/_/g, " ").replace(/-/g, " ");
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fieldAnswerText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function fieldAnswerList(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
