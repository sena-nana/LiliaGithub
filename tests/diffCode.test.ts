import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/vue";
import RepoDiffWorkspace from "../src/components/repo/RepoDiffWorkspace.vue";
import { parseRepoDiffHunks } from "../src/components/repo/repoDiffWorkspace";
import {
  diffCodeLanguageLabel,
  inferDiffCodeLanguage,
  isDiffCodeLanguage,
  tokenizeDiffCodeLine,
} from "../src/utils/diffCode";

function expectHighlightedText(line: string, language: Parameters<typeof tokenizeDiffCodeLine>[1]) {
  const tokens = tokenizeDiffCodeLine(line, language);

  expect(tokens.map((token) => token.text).join("")).toBe(line);
  expect(tokens.some((token) => token.type !== "plain")).toBe(true);
}

describe("diff code rendering helpers", () => {
  it("infers common diff languages from file paths", () => {
    expect(inferDiffCodeLanguage("src/App.vue")).toBe("vue");
    expect(inferDiffCodeLanguage("src-tauri/src/workspace.rs")).toBe("rust");
    expect(inferDiffCodeLanguage("package.json")).toBe("json");
    expect(inferDiffCodeLanguage("README.md")).toBe("markdown");
    expect(inferDiffCodeLanguage("pnpm-workspace.yaml")).toBe("yaml");
    expect(inferDiffCodeLanguage("Cargo.toml")).toBe("toml");
    expect(inferDiffCodeLanguage("README.unknown")).toBe("text");
  });

  it("labels code languages for file previews", () => {
    expect(isDiffCodeLanguage(inferDiffCodeLanguage("src/main.ts"))).toBe(true);
    expect(diffCodeLanguageLabel(inferDiffCodeLanguage("src/main.ts"))).toBe("TypeScript");
    expect(diffCodeLanguageLabel(inferDiffCodeLanguage("pnpm-workspace.yaml"))).toBe("YAML");
    expect(isDiffCodeLanguage(inferDiffCodeLanguage("notes.txt"))).toBe(false);
  });

  it("highlights supported languages without changing rendered text", () => {
    expectHighlightedText("  <h1>LiliaGithub</h1>", "vue");
    expectHighlightedText("  pub github_full_name: Option<String>,", "rust");
    expectHighlightedText("export const title: string = \"Lilia\";", "typescript");
    expectHighlightedText("## Use `pnpm test` in [CI](https://example.com)", "markdown");
  });

  it("falls back to plain text for unknown languages and empty lines", () => {
    expect(tokenizeDiffCodeLine("plain <h1>", "text").map((token) => token.text).join("")).toBe("plain <h1>");
    expect(tokenizeDiffCodeLine("", "typescript").map((token) => token.text).join("")).toBe("");
  });

  it("parses workspace raw patches into commit-style hunks", () => {
    const hunks = parseRepoDiffHunks([
      "diff --git a/src/App.vue b/src/App.vue",
      "index 1111111..2222222 100644",
      "--- a/src/App.vue",
      "+++ b/src/App.vue",
      "@@ -1,2 +1,3 @@",
      " <template>",
      "-  <h1>Lilia</h1>",
      "+  <h1>LiliaGithub</h1>",
      "+  <p>本地仓库管理</p>",
      " </template>",
    ].join("\n"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe("@@ -1,2 +1,3 @@");
    expect(hunks[0].lines).toEqual([
      { kind: "context", content: "<template>", oldLine: 1, newLine: 1 },
      { kind: "deleted", content: "  <h1>Lilia</h1>", oldLine: 2, newLine: null },
      { kind: "added", content: "  <h1>LiliaGithub</h1>", oldLine: null, newLine: 2 },
      { kind: "added", content: "  <p>本地仓库管理</p>", oldLine: null, newLine: 3 },
      { kind: "context", content: "</template>", oldLine: 3, newLine: 4 },
    ]);
  });

  it("parses added and deleted file patches with dev null headers", () => {
    const added = parseRepoDiffHunks([
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+created()",
    ].join("\n"));
    const deleted = parseRepoDiffHunks([
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-removed()",
    ].join("\n"));

    expect(added[0].lines).toEqual([
      { kind: "added", content: "created()", oldLine: null, newLine: 1 },
    ]);
    expect(deleted[0].lines).toEqual([
      { kind: "deleted", content: "removed()", oldLine: 1, newLine: null },
    ]);
  });

  it("renders raw diff when a file has patch text without hunks", () => {
    const file = {
      key: "docs/renamed.md",
      path: "docs/renamed.md",
      oldPath: "docs/old.md",
      statusLabel: "重命名",
      statusLetter: "R",
      patch: [
        "diff --git a/docs/old.md b/docs/renamed.md",
        "similarity index 100%",
        "rename from docs/old.md",
        "rename to docs/renamed.md",
      ].join("\n"),
      hunks: [],
    };

    render(RepoDiffWorkspace, {
      props: {
        files: [file],
        activeFile: file,
        fileCountLabel: "1 个文件",
        emptyFileText: "没有文件",
        emptyDiffText: "没有 diff",
        mode: "hunks",
      },
    });

    const diffPanel = screen.getByLabelText("改动文件 diff");
    expect(diffPanel).toHaveTextContent("diff --git a/docs/old.md b/docs/renamed.md");
    expect(diffPanel).toHaveTextContent("rename to docs/renamed.md");
    expect(diffPanel).not.toHaveTextContent("没有 diff");
  });
});
