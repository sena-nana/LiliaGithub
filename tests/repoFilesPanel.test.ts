import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoFilesPanel from "../src/components/repo/RepoFilesPanel.vue";
import type { RepoFilePreview, RepoFileTreeEntry } from "../src/services/workspace/types";

const clientMocks = vi.hoisted(() => ({
  listRepoFiles: vi.fn<(repoId: string, parentPath?: string | null) => Promise<RepoFileTreeEntry[]>>(),
  getRepoFilePreview: vi.fn<(repoId: string, path: string) => Promise<RepoFilePreview>>(),
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

async function renderFilesPanel() {
  return render(RepoFilesPanel, {
    props: {
      repoId: "LiliaGithub",
      repoPath: "C:\\Files\\workspace\\LiliaGithub",
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

  it("文件树节点显示完整名称", async () => {
    listRepoFiles.mockResolvedValueOnce([
      dir("docs", "docs"),
      file("pnpm-workspace.yaml", "pnpm-workspace.yaml"),
    ]);

    await renderFilesPanel();

    expect(await screen.findByRole("button", { name: /docs/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pnpm-workspace\.yaml/ })).toBeInTheDocument();
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
