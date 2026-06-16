import { describe, expect, it } from "vitest";
import { inferDiffCodeLanguage, tokenizeDiffCodeLine } from "../src/utils/diffCode";

describe("diff code rendering helpers", () => {
  it("infers common diff languages from file paths", () => {
    expect(inferDiffCodeLanguage("src/App.vue")).toBe("vue");
    expect(inferDiffCodeLanguage("src-tauri/src/workspace.rs")).toBe("rust");
    expect(inferDiffCodeLanguage("package.json")).toBe("json");
    expect(inferDiffCodeLanguage("README.md")).toBe("markdown");
    expect(inferDiffCodeLanguage("scripts/check.py")).toBe("python");
    expect(inferDiffCodeLanguage("README.unknown")).toBe("text");
  });

  it("tokenizes markup without changing the rendered text", () => {
    const line = "  <h1>LiliaGithub</h1>";
    const tokens = tokenizeDiffCodeLine(line, "vue");

    expect(tokens.map((token) => token.text).join("")).toBe(line);
    expect(tokens).toEqual(expect.arrayContaining([
      { type: "punctuation", text: "<" },
      { type: "type", text: "h1" },
      { type: "plain", text: "LiliaGithub" },
    ]));
  });

  it("tokenizes Rust keywords and types while preserving spacing", () => {
    const line = "  pub github_full_name: Option<String>,";
    const tokens = tokenizeDiffCodeLine(line, "rust");

    expect(tokens.map((token) => token.text).join("")).toBe(line);
    expect(tokens).toEqual(expect.arrayContaining([
      { type: "keyword", text: "pub" },
      { type: "type", text: "Option" },
      { type: "type", text: "String" },
    ]));
  });

  it("tokenizes TypeScript keywords and strings", () => {
    const line = "export const title: string = \"Lilia\";";
    const tokens = tokenizeDiffCodeLine(line, "typescript");

    expect(tokens.map((token) => token.text).join("")).toBe(line);
    expect(tokens).toEqual(expect.arrayContaining([
      { type: "keyword", text: "export" },
      { type: "keyword", text: "const" },
      { type: "string", text: "\"Lilia\"" },
    ]));
  });

  it("tokenizes Python keywords and comments", () => {
    const line = "def build_name(value): # keep label";
    const tokens = tokenizeDiffCodeLine(line, "python");

    expect(tokens.map((token) => token.text).join("")).toBe(line);
    expect(tokens).toEqual(expect.arrayContaining([
      { type: "keyword", text: "def" },
      { type: "comment", text: "# keep label" },
    ]));
  });

  it("tokenizes Markdown headings, inline code, and links", () => {
    const line = "## Use `yarn test` in [CI](https://example.com)";
    const tokens = tokenizeDiffCodeLine(line, "markdown");

    expect(tokens.map((token) => token.text).join("")).toBe(line);
    expect(tokens).toEqual(expect.arrayContaining([
      { type: "keyword", text: "##" },
      { type: "string", text: "`yarn test`" },
      { type: "property", text: "[CI](https://example.com)" },
    ]));
  });

  it("falls back to plain text for unknown languages and empty lines", () => {
    expect(tokenizeDiffCodeLine("plain <h1>", "text")).toEqual([{ type: "plain", text: "plain <h1>" }]);
    expect(tokenizeDiffCodeLine("", "typescript")).toEqual([{ type: "plain", text: "" }]);
  });
});
