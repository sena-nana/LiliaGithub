import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import MarkdownReadme from "../src/components/repo/MarkdownReadme.vue";
import { resolveReadmeLink } from "../src/utils/readmeLinks";

describe("MarkdownReadme", () => {
  it("does not render README maintenance comments", () => {
    const { container } = render(MarkdownReadme, {
      props: {
        content:
          "<!-- To replace the main window screenshot, keep the file name .github/assets/main-window.png to avoid README changes. -->\n\n# LiliaCode",
      },
    });

    expect(screen.getByRole("heading", { level: 1, name: "LiliaCode" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "LiliaCode" })).toHaveAttribute("id", "liliacode");
    expect(container).not.toHaveTextContent("To replace the main window screenshot");
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

  it("shows a link toolbar before opening markdown links", async () => {
    const { emitted } = render(MarkdownReadme, {
      props: {
        content: "[Markdown](https://example.com/md/with/a/very/long/path)",
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "Markdown" }), { clientX: 24, clientY: 32 });

    const toolbar = await screen.findByRole("toolbar", { name: "链接操作" });
    const href = screen.getByTitle("https://example.com/md/with/a/very/long/path");
    expect(toolbar).toBeInTheDocument();
    expect(href).toHaveTextContent("https://example.com/md/with/a/very/long/path");
    expect(emitted("openLink")).toBeUndefined();

    await fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(emitted("openLink")?.at(-1)?.[0]).toMatchObject({
      kind: "external",
      href: "https://example.com/md/with/a/very/long/path",
    });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "链接操作" })).toBeNull());
  });

  it("shows the same toolbar for HTML links", async () => {
    const { emitted } = render(MarkdownReadme, {
      props: {
        content: '<a href="https://example.com/html">HTML</a>',
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "HTML" }));
    expect(await screen.findByRole("toolbar", { name: "链接操作" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(emitted("openLink")?.at(-1)?.[0]).toMatchObject({ kind: "external", href: "https://example.com/html" });
  });

  it("opens safe relative links as structured README or file targets", async () => {
    const { emitted } = render(MarkdownReadme, {
      props: {
        content: "[Relative](./README.zh-CN.md#intro) and [Guide](docs/guide.md)",
        repoRootPath: "C:\\Files\\workspace\\LiliaGithub",
        currentReadmePath: "README.md",
        readmePaths: ["README.md", "README.zh-CN.md"],
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "Relative" }));
    expect(await screen.findByTitle("./README.zh-CN.md#intro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).not.toBeDisabled();

    await fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(emitted("openLink")?.at(-1)?.[0]).toMatchObject({ kind: "readme", path: "README.zh-CN.md", hash: "intro" });

    await fireEvent.click(screen.getByRole("link", { name: "Guide" }));
    expect(await screen.findByTitle("docs/guide.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).not.toBeDisabled();

    await fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(emitted("openLink")?.at(-1)?.[0]).toMatchObject({
      kind: "file",
      relativePath: "docs/guide.md",
      absolutePath: "C:\\Files\\workspace\\LiliaGithub\\docs\\guide.md",
    });
  });

  it("scrolls current README anchors from the link toolbar", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const { emitted } = render(MarkdownReadme, {
      props: {
        content: "# Title\n\n[Jump](#next-section)\n\n## Next Section",
        repoRootPath: "C:\\Files\\workspace\\LiliaGithub",
        currentReadmePath: "README.md",
        readmePaths: ["README.md"],
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "Jump" }));
    expect(await screen.findByTitle("#next-section")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).not.toBeDisabled();

    await fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(emitted("openLink")).toBeUndefined();
  });

  it("disables unsafe or unsupported non-web links", async () => {
    const { emitted } = render(MarkdownReadme, {
      props: {
        content: "[Parent](../secret.md) [Absolute](C:/secret.md) [Mail](mailto:hello@example.com)",
        repoRootPath: "C:\\Files\\workspace\\LiliaGithub",
        currentReadmePath: "README.md",
        readmePaths: ["README.md"],
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "Parent" }));
    expect(await screen.findByTitle("../secret.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toBeDisabled();

    expect(screen.getByText("Absolute")).not.toHaveAttribute("href");

    await fireEvent.click(screen.getByRole("link", { name: "Mail" }));
    expect(await screen.findByTitle("mailto:hello@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toBeDisabled();
    expect(emitted("openLink")).toBeUndefined();
  });

  it("closes the link toolbar with Escape and outside clicks", async () => {
    render(MarkdownReadme, {
      props: {
        content: "[Markdown](https://example.com/md)\n\nPlain text",
      },
    });

    await fireEvent.click(screen.getByRole("link", { name: "Markdown" }));
    expect(await screen.findByRole("toolbar", { name: "链接操作" })).toBeInTheDocument();

    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "链接操作" })).toBeNull());

    await fireEvent.click(screen.getByRole("link", { name: "Markdown" }));
    expect(await screen.findByRole("toolbar", { name: "链接操作" })).toBeInTheDocument();

    await fireEvent.pointerDown(screen.getByLabelText("README 内容"));
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "链接操作" })).toBeNull());

    await fireEvent.click(screen.getByRole("link", { name: "Markdown" }));
    expect(await screen.findByRole("toolbar", { name: "链接操作" })).toBeInTheDocument();

    await fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "链接操作" })).toBeNull());
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

describe("resolveReadmeLink", () => {
  it("resolves README-directory and repo-root relative links safely", () => {
    expect(resolveReadmeLink({
      href: "../guide.md",
      repoRootPath: "C:\\repo",
      currentReadmePath: "docs/README.md",
      readmePaths: [],
    })).toBeNull();
    expect(resolveReadmeLink({
      href: "./guide.md",
      repoRootPath: "C:\\repo",
      currentReadmePath: "docs/README.md",
      readmePaths: [],
    })).toEqual({
      kind: "file",
      relativePath: "docs/guide.md",
      absolutePath: "C:\\repo\\docs\\guide.md",
      hash: null,
    });
    expect(resolveReadmeLink({
      href: "/docs/guide.md#intro",
      repoRootPath: "C:\\repo",
      currentReadmePath: "README.md",
      readmePaths: ["docs/guide.md"],
    })).toEqual({ kind: "readme", path: "docs/guide.md", hash: "intro" });
    expect(resolveReadmeLink({
      href: "mailto:hello@example.com",
      repoRootPath: "C:\\repo",
      currentReadmePath: "README.md",
      readmePaths: [],
    })).toBeNull();
  });
});
