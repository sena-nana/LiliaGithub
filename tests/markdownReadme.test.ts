import { fireEvent, render, screen } from "@testing-library/vue";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import MarkdownReadme from "../src/components/repo/MarkdownReadme.vue";

describe("MarkdownReadme", () => {
  it("does not render README maintenance comments", () => {
    const { container } = render(MarkdownReadme, {
      props: {
        content:
          "<!-- To replace the main window screenshot, keep the file name .github/assets/main-window.png to avoid README changes. -->\n\n# LiliaCode",
      },
    });

    expect(screen.getByRole("heading", { level: 1, name: "LiliaCode" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent("To replace the main window screenshot");
    expect(container.innerHTML).not.toContain("<!--");
  });

  it("renders safe inline HTML inside README markdown", () => {
    const { container } = render(MarkdownReadme, {
      props: {
        content: "# Keys\n\nPress <kbd>Ctrl</kbd><br><sub>x</sub> <mark>now</mark>.",
      },
    });

    expect(screen.getByRole("heading", { level: 1, name: "Keys" })).toBeInTheDocument();
    expect(container.querySelector("kbd")).toHaveTextContent("Ctrl");
    expect(container.querySelector("br")).toBeInTheDocument();
    expect(container.querySelector("sub")).toHaveTextContent("x");
    expect(container.querySelector("mark")).toHaveTextContent("now");
  });

  it("renders common README HTML blocks used by Lilia", () => {
    const { container } = render(MarkdownReadme, {
      props: {
        images: {
          "./apps/desktop/src-tauri/icons/icon.png": "data:image/png;base64,badge",
          "./.github/assets/main-window.png": "data:image/png;base64,window",
        },
        content: `<p align="center">
  <a href="https://example.com">
    <img alt="badge" src="./apps/desktop/src-tauri/icons/icon.png" width="128">
  </a>
</p>

<h1 align="center">LiliaCode</h1>

---

![window](./.github/assets/main-window.png)

- [x] Done
- [ ] Todo`,
      },
    });

    expect(screen.getByRole("heading", { level: 1, name: "LiliaCode" })).toHaveAttribute("align", "center");
    expect(container.querySelector("p")).toHaveAttribute("align", "center");
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com");
    expect(screen.getByAltText("badge")).toHaveAttribute("alt", "badge");
    expect(screen.getByAltText("badge")).toHaveAttribute("width", "128");
    expect(screen.getByAltText("badge")).toHaveAttribute("src", "data:image/png;base64,badge");
    expect(screen.getByAltText("window")).toHaveAttribute("alt", "window");
    expect(screen.getByAltText("window")).toHaveAttribute("src", "data:image/png;base64,window");
    expect(container.querySelector("hr")).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("renders multiline README blockquotes without empty quote blocks", () => {
    const { container } = render(MarkdownReadme, {
      props: {
        content: `> English | [简体中文](./README.zh-CN.md) | [Documentation](https://example.com/docs)
>
> **Development Status**
>
> LiliaCode is still changing quickly. Core features are not fully complete.
> Data may be cleared or migrated at any time.`,
      },
    });

    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
    expect(container.querySelector("blockquote strong")).toHaveTextContent("Development Status");
    expect(container.querySelector("blockquote")).toHaveTextContent("English | 简体中文 | Documentation");
    expect(container.querySelector("blockquote")).toHaveTextContent(
      "LiliaCode is still changing quickly. Core features are not fully complete. Data may be cleared or migrated at any time.",
    );
  });

  it("caps README image display size in the component styles", () => {
    const source = readFileSync("src/components/repo/MarkdownReadme.vue", "utf8");

    expect(source).toContain(".readme-render :deep(img)");
    expect(source).toContain("max-width: min(45%, 160px)");
    expect(source).toContain("max-height: 160px");
    expect(source).toContain("object-fit: contain");
    expect(source).toContain(":where(p > img:only-child, p > a:only-child img:only-child):not([width]):not([height])");
    expect(source).toContain("max-width: 90%");
    expect(source).toContain("max-height: min(70vh, 640px)");
  });

  it("aligns README task list checkboxes with item text", () => {
    const source = readFileSync("src/components/repo/MarkdownReadme.vue", "utf8");

    expect(source).toContain('.readme-render :deep(li > input[type="checkbox"])');
    expect(source).toContain("vertical-align: -2px");
  });

  it("removes unsafe tags, attributes, and urls", () => {
    const { container } = render(MarkdownReadme, {
      props: {
        content: `Safe <kbd onclick="window.__hit = true">Ctrl</kbd><script>window.__hit = true</script><a href="javascript:alert(1)" onclick="window.__hit = true">bad</a><img src="data:image/svg+xml;base64,abc" alt="bad" onerror="window.__hit = true"><input type="text">`,
      },
    });

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("kbd")).not.toHaveAttribute("onclick");
    expect(container.querySelector("a")).not.toHaveAttribute("href");
    expect(container.querySelector("a")).not.toHaveAttribute("onclick");
    expect(container.querySelector("img")).not.toHaveAttribute("src");
    expect(container.querySelector("img")).not.toHaveAttribute("onerror");
    expect(container.querySelector('input[type="text"]')).not.toBeInTheDocument();
  });

  it("emits openLink for markdown and HTML links", async () => {
    const { emitted } = render(MarkdownReadme, {
      props: {
        content: "[Markdown](https://example.com/md) and <a href=\"https://example.com/html\">HTML</a>",
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "Markdown" }));
    await fireEvent.click(screen.getByRole("link", { name: "HTML" }));

    expect(emitted("openLink")).toEqual([["https://example.com/md"], ["https://example.com/html"]]);
  });

  it("keeps existing markdown headings, lists, and code blocks", () => {
    render(MarkdownReadme, {
      props: {
        content: "# Title\n\n- one\n- `two`\n\n```\nconst ok = true;\n```",
      },
    });

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveTextContent("one");
    expect(screen.getByRole("list")).toHaveTextContent("two");
    expect(screen.getByText("const ok = true;")).toBeInTheDocument();
  });
});
