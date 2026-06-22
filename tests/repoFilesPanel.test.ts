import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoFilesPanel from "../src/components/repo/RepoFilesPanel.vue";
import type { RepoChange, RepoFilePreview, RepoFileTreeEntry } from "../src/services/workspace/types";

const clientMocks = vi.hoisted(() => ({
  listRepoFiles: vi.fn<(repoId: string, parentPath?: string | null, repoRef?: string | null) => Promise<RepoFileTreeEntry[]>>(),
  getRepoFilePreview: vi.fn<(repoId: string, path: string, repoRef?: string | null) => Promise<RepoFilePreview>>(),
  openPath: vi.fn<(path: string) => Promise<void>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
}));

const { listRepoFiles, getRepoFilePreview, openPath, openUrl } = clientMocks;

vi.mock("../src/services/workspace/client", () => ({
  listRepoFiles: clientMocks.listRepoFiles,
  getRepoFilePreview: clientMocks.getRepoFilePreview,
  openPath: clientMocks.openPath,
  openUrl: clientMocks.openUrl,
}));

async function renderFilesPanel(props: Record<string, unknown> = {}) {
  return render(RepoFilesPanel, {
    props: {
      repoId: "LiliaGithub",
      repoPath: "C:\\Files\\workspace\\LiliaGithub",
      ...props,
    },
  });
}

function file(path: string, name = path): RepoFileTreeEntry {
  return { path, name, kind: "file", hasChildren: false };
}

function dir(path: string, name = path.split("/").at(-1) ?? path, hasChildren = true): RepoFileTreeEntry {
  return { path, name, kind: "dir", hasChildren };
}

function preview(overrides: Partial<RepoFilePreview> & Pick<RepoFilePreview, "path" | "name" | "previewKind" | "size">): RepoFilePreview {
  return {
    content: undefined,
    dataUrl: null,
    images: {},
    mimeType: null,
    truncated: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function change(overrides: Partial<RepoChange> & Pick<RepoChange, "path">): RepoChange {
  return {
    path: overrides.path,
    oldPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    diff: "",
    ...overrides,
  };
}

describe("RepoFilesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("根目录为空时显示空状态", async () => {
    listRepoFiles.mockResolvedValueOnce([]);

    await renderFilesPanel();

    expect(await screen.findByText("当前仓库没有可浏览文件。")).toBeInTheDocument();
    expect(screen.getByText("选择一个文件查看内容。")).toBeInTheDocument();
  });

  it("根目录存在 README.md 时自动选中并预览", async () => {
    listRepoFiles.mockResolvedValueOnce([file("README.md")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "README.md",
      name: "README.md",
      previewKind: "markdown",
      content: "# Guide\n\n- ready",
      size: 18,
    }));

    await renderFilesPanel();

    expect(await screen.findByRole("heading", { level: 1, name: "Guide" })).toBeInTheDocument();
    expect(getRepoFilePreview).toHaveBeenCalledWith("LiliaGithub", "README.md");
  });

  it("目录展开和收起只在首次展开时加载子项", async () => {
    listRepoFiles.mockResolvedValueOnce([dir("src")]);
    listRepoFiles.mockResolvedValueOnce([file("src/App.vue", "App.vue")]);

    await renderFilesPanel();

    const srcButton = await screen.findByRole("button", { name: /src/ });
    await fireEvent.click(srcButton);
    await screen.findByRole("button", { name: /App\.vue/ });
    await fireEvent.click(srcButton);
    await fireEvent.click(srcButton);

    expect(listRepoFiles).toHaveBeenNthCalledWith(1, "LiliaGithub", null);
    expect(listRepoFiles).toHaveBeenNthCalledWith(2, "LiliaGithub", "src");
    expect(listRepoFiles).toHaveBeenCalledTimes(2);
  });

  it("文件树节点显示完整名称，并在右侧标注变更状态", async () => {
    listRepoFiles.mockResolvedValueOnce([
      dir("docs", "docs"),
      file("src/main.ts", "main.ts"),
      file("src/App.vue", "App.vue"),
      file("README.md", "README.md"),
      file("pnpm-workspace.yaml", "pnpm-workspace.yaml"),
    ]);

    await renderFilesPanel({
      changes: [
        change({ path: "src/main.ts", staged: true, unstaged: true }),
        change({ path: "src/App.vue" }),
        change({ path: "README.md", unstaged: false, untracked: true, worktreeStatus: "?" }),
      ],
    });

    expect(await screen.findByRole("button", { name: /docs/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /main\.ts/ }).querySelector(".sb-tree__name")).not.toHaveClass("diff-code__token--keyword");
    expect(screen.getByRole("button", { name: /main\.ts/ }).querySelector(".files-tree__badge")).toHaveTextContent("M");
    expect(screen.getByRole("button", { name: /main\.ts/ }).querySelector(".files-tree__badge")).toHaveClass("change-badge--accent");
    expect(screen.getByRole("button", { name: /App\.vue/ }).querySelector(".files-tree__badge")).toHaveTextContent("W");
    expect(screen.getByRole("button", { name: /App\.vue/ }).querySelector(".files-tree__badge")).toHaveClass("change-badge--muted");
    expect(screen.getByRole("button", { name: /README\.md/ }).querySelector(".files-tree__badge")).toHaveTextContent("U");
    expect(screen.getByRole("button", { name: /README\.md/ }).querySelector(".files-tree__badge")).toHaveClass("change-badge--warn");
    expect(screen.getByRole("button", { name: /pnpm-workspace\.yaml/ }).querySelector(".files-tree__badge")).toBeNull();
  });

  it("点击文本文件时显示原始文本预览", async () => {
    listRepoFiles.mockResolvedValueOnce([file("notes.txt")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "notes.txt",
      name: "notes.txt",
      previewKind: "text",
      content: "line 1\nline 2",
      size: 12,
    }));

    await renderFilesPanel();
    await fireEvent.click(await screen.findByRole("button", { name: /notes\.txt/ }));

    await waitFor(() => {
      expect(document.querySelector(".files-main__code")?.textContent).toBe("line 1\nline 2");
    });
  });

  it("快速切换文件时只显示最后选中的预览", async () => {
    const firstPreview = deferred<RepoFilePreview>();
    const secondPreview = deferred<RepoFilePreview>();
    listRepoFiles.mockResolvedValueOnce([file("first.txt"), file("second.txt")]);
    getRepoFilePreview
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise);

    await renderFilesPanel();

    await fireEvent.click(await screen.findByRole("button", { name: /first\.txt/ }));
    await fireEvent.click(screen.getByRole("button", { name: /second\.txt/ }));
    secondPreview.resolve(preview({
      path: "second.txt",
      name: "second.txt",
      previewKind: "text",
      content: "second file",
      size: 11,
    }));

    await waitFor(() => {
      expect(document.querySelector(".files-main__code")?.textContent).toBe("second file");
    });

    firstPreview.resolve(preview({
      path: "first.txt",
      name: "first.txt",
      previewKind: "text",
      content: "first file",
      size: 10,
    }));

    await waitFor(() => {
      expect(document.querySelector(".files-main__code")?.textContent).toBe("second file");
    });
    expect(screen.queryByText("first file")).toBeNull();
  });

  it("切换仓库时忽略旧仓库延迟返回的文件树", async () => {
    const firstRoot = deferred<RepoFileTreeEntry[]>();
    const secondRoot = deferred<RepoFileTreeEntry[]>();
    listRepoFiles
      .mockReturnValueOnce(firstRoot.promise)
      .mockReturnValueOnce(secondRoot.promise);

    const view = await renderFilesPanel({ repoId: "old-repo" });
    await view.rerender({ repoId: "new-repo" });
    secondRoot.resolve([file("new.txt")]);

    expect(await screen.findByRole("button", { name: /new\.txt/ })).toBeInTheDocument();

    firstRoot.resolve([file("old.txt")]);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /old\.txt/ })).toBeNull();
    });
    expect(listRepoFiles).toHaveBeenNthCalledWith(1, "old-repo", null);
    expect(listRepoFiles).toHaveBeenNthCalledWith(2, "new-repo", null);
  });

  it("远程仓库按当前分支读取文件树并隐藏本地打开按钮", async () => {
    listRepoFiles
      .mockResolvedValueOnce([file("README.md")])
      .mockResolvedValueOnce([file("README.md")]);
    getRepoFilePreview
      .mockResolvedValueOnce(preview({
        path: "README.md",
        name: "README.md",
        previewKind: "markdown",
        content: "# Main branch\n",
        size: 14,
      }))
      .mockResolvedValueOnce(preview({
        path: "README.md",
        name: "README.md",
        previewKind: "markdown",
        content: "# Dev branch\n",
        size: 13,
      }));

    const view = await renderFilesPanel({
      repoId: "github:sena-nana/remote-repo",
      repoPath: null,
      repoRef: "main",
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Main branch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开文件" })).toBeNull();

    await view.rerender({
      repoId: "github:sena-nana/remote-repo",
      repoPath: null,
      repoRef: "dev",
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Dev branch" })).toBeInTheDocument();
    expect(listRepoFiles).toHaveBeenNthCalledWith(1, "github:sena-nana/remote-repo", null, "main");
    expect(listRepoFiles).toHaveBeenNthCalledWith(2, "github:sena-nana/remote-repo", null, "dev");
    expect(getRepoFilePreview).toHaveBeenNthCalledWith(1, "github:sena-nana/remote-repo", "README.md", "main");
    expect(getRepoFilePreview).toHaveBeenNthCalledWith(2, "github:sena-nana/remote-repo", "README.md", "dev");
  });

  it("代码文本预览复用 diff token 高亮", async () => {
    listRepoFiles.mockResolvedValueOnce([file("src/main.ts", "main.ts")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "src/main.ts",
      name: "main.ts",
      previewKind: "text",
      content: "export const title = \"Lilia\";",
      size: 29,
    }));

    await renderFilesPanel();
    await fireEvent.click(await screen.findByRole("button", { name: /main\.ts/ }));

    await waitFor(() => {
      expect(document.querySelector(".files-main__code .diff-code__token--keyword")).toHaveTextContent("export");
      expect(document.querySelector(".files-main__code .diff-code__token--string")).toHaveTextContent("\"Lilia\"");
    });
  });

  it("Markdown 文件使用富文本渲染", async () => {
    listRepoFiles.mockResolvedValueOnce([file("guide.md")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "guide.md",
      name: "guide.md",
      previewKind: "markdown",
      content: "# Guide\n\n[官网](https://example.com)\n",
      size: 32,
    }));

    await renderFilesPanel();
    await fireEvent.click(await screen.findByRole("button", { name: /guide\.md/ }));

    expect(await screen.findByRole("heading", { level: 1, name: "Guide" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "官网" })).toBeInTheDocument();
  });

  it("图片文件以内联图片方式预览", async () => {
    listRepoFiles.mockResolvedValueOnce([file("cover.png")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "cover.png",
      name: "cover.png",
      previewKind: "image",
      dataUrl: "data:image/png;base64,AQID",
      size: 3,
    }));

    await renderFilesPanel();
    await fireEvent.click(await screen.findByRole("button", { name: /cover\.png/ }));

    const image = await screen.findByRole("img", { name: "cover.png" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,AQID");
  });

  it("二进制和超大文件显示不可预览提示", async () => {
    listRepoFiles.mockResolvedValueOnce([file("archive.bin"), file("huge.log")]);
    getRepoFilePreview
      .mockResolvedValueOnce(preview({
        path: "archive.bin",
        name: "archive.bin",
        previewKind: "binary",
        size: 2048,
      }))
      .mockResolvedValueOnce(preview({
        path: "huge.log",
        name: "huge.log",
        previewKind: "tooLarge",
        size: 1024 * 1024 + 5,
      }));

    await renderFilesPanel();

    await fireEvent.click(await screen.findByRole("button", { name: /archive\.bin/ }));
    expect(await screen.findByText("暂不支持预览")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /huge\.log/ }));
    await waitFor(() => {
      expect(screen.getByText("文件过大")).toBeInTheDocument();
    });
  });
});
