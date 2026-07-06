import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { ContextMenuHost, closeContextMenu, installContextMenu, uninstallContextMenu, vContextMenu } from "@lilia/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { invalidateSessionContextSnapshot, resetSessionContextForTests } from "../src/composables/sessionContext";
import RepoFilesPanel from "../src/components/repo/RepoFilesPanel.vue";
import type { RepoChange, RepoFilePreview, RepoFileTreeEntry, RepoSummary } from "../src/services/workspace/types";

const clientMocks = vi.hoisted(() => ({
  listRepoFiles: vi.fn<(repoId: string, parentPath?: string | null, repoRef?: string | null) => Promise<RepoFileTreeEntry[]>>(),
  getRepoFilePreview: vi.fn<(repoId: string, path: string, repoRef?: string | null) => Promise<RepoFilePreview>>(),
  deleteRepoFile: vi.fn<(repoId: string, path: string) => Promise<RepoSummary>>(),
  refreshRepoDetailPatch: vi.fn(),
  openPath: vi.fn<(path: string) => Promise<void>>(),
  openPathTarget: vi.fn<(path: string, target: string) => Promise<void>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
}));

const { listRepoFiles, getRepoFilePreview, deleteRepoFile, refreshRepoDetailPatch, openPath, openPathTarget, openUrl } = clientMocks;

vi.mock("../src/services/workspace/client", () => ({
  listRepoFiles: clientMocks.listRepoFiles,
  getRepoFilePreview: clientMocks.getRepoFilePreview,
  deleteRepoFile: clientMocks.deleteRepoFile,
  refreshRepoDetailPatch: clientMocks.refreshRepoDetailPatch,
  openPath: clientMocks.openPath,
  openPathTarget: clientMocks.openPathTarget,
  openUrl: clientMocks.openUrl,
}));

async function renderFilesPanel(props: Record<string, unknown> = {}) {
  const panelProps = {
    repoId: "LiliaGithub",
    repoPath: "C:\\Files\\workspace\\LiliaGithub",
    ...props,
  };
  const Wrapper = defineComponent({
    components: { ContextMenuHost, RepoFilesPanel },
    props: ["repoId", "repoPath", "repoRef", "changes", "targetPath", "targetHash"],
    template: "<RepoFilesPanel v-bind=\"$props\" /><ContextMenuHost />",
  });
  return render(Wrapper, {
    props: panelProps,
    global: {
      directives: {
        contextMenu: vContextMenu,
      },
      stubs: {
        transition: false,
      },
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

function summary(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    id: "LiliaGithub",
    name: "LiliaGithub",
    path: "C:\\Files\\workspace\\LiliaGithub",
    relativePath: "LiliaGithub",
    currentBranch: "main",
    remoteUrl: null,
    githubFullName: null,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    lastCommitAt: null,
    lastCommitMessage: null,
    languageStats: [],
    languageStatsUpdatedAt: 0,
    worktree: {
      role: "standalone",
      sharedRepoKey: "LiliaGithub",
      mainRepoId: null,
    },
    ...overrides,
  };
}

describe("RepoFilesPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    closeContextMenu();
    installContextMenu();
    resetSessionContextForTests();
    openPath.mockResolvedValue(undefined);
    openPathTarget.mockResolvedValue(undefined);
    deleteRepoFile.mockResolvedValue(summary());
    refreshRepoDetailPatch.mockResolvedValue({
      summary: summary(),
      changes: [],
      conflicts: {
        operation: "none",
        files: [],
        allResolved: true,
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    closeContextMenu();
    uninstallContextMenu();
  });

  it("根目录为空时显示空状态", async () => {
    listRepoFiles.mockResolvedValueOnce([]);

    await renderFilesPanel();

    expect(screen.getByText("C:\\Files\\workspace\\LiliaGithub")).toBeInTheDocument();
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

  it("根目录加载完成后不等待自动预览即可显示文件树", async () => {
    const readmePreview = deferred<RepoFilePreview>();
    listRepoFiles.mockResolvedValueOnce([file("README.md")]);
    getRepoFilePreview.mockReturnValueOnce(readmePreview.promise);

    await renderFilesPanel();

    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.queryByText("正在读取文件树。")).toBeNull();
    expect(screen.getByText("正在读取文件内容。")).toBeInTheDocument();
    expect(screen.queryByText("选择一个文件查看内容。")).toBeNull();

    readmePreview.resolve(preview({
      path: "README.md",
      name: "README.md",
      previewKind: "markdown",
      content: "# Ready",
      size: 7,
    }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ready" })).toBeInTheDocument();
  });

  it("等价仓库初始化重复触发时复用根目录请求", async () => {
    const rootEntries = deferred<RepoFileTreeEntry[]>();
    const readmePreview = deferred<RepoFilePreview>();
    listRepoFiles.mockReturnValueOnce(rootEntries.promise);
    getRepoFilePreview.mockReturnValueOnce(readmePreview.promise);

    const view = await renderFilesPanel();
    await view.rerender({
      repoId: "LiliaGithub",
      repoPath: "C:\\Files\\workspace\\LiliaGithub",
      repoRef: null,
    });
    rootEntries.resolve([file("README.md")]);

    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.queryByText("正在读取文件树。")).toBeNull();
    expect(screen.getByText("正在读取文件内容。")).toBeInTheDocument();
    expect(listRepoFiles).toHaveBeenCalledTimes(1);
  });

  it("文件树请求期间会话上下文失效后仍能显示根目录", async () => {
    const rootEntries = deferred<RepoFileTreeEntry[]>();
    const readmePreview = deferred<RepoFilePreview>();
    listRepoFiles.mockReturnValueOnce(rootEntries.promise);
    getRepoFilePreview.mockReturnValueOnce(readmePreview.promise);

    await renderFilesPanel();
    invalidateSessionContextSnapshot();
    rootEntries.resolve([file("README.md")]);

    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeInTheDocument();
    expect(screen.queryByText("正在读取文件树。")).toBeNull();
    expect(screen.getByText("正在读取文件内容。")).toBeInTheDocument();
  });

  it("根目录没有 README 时自动选择第一个文件预览", async () => {
    listRepoFiles.mockResolvedValueOnce([
      dir("src"),
      file("package.json", "package.json"),
      file("notes.txt", "notes.txt"),
    ]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "package.json",
      name: "package.json",
      previewKind: "text",
      content: "{\"name\":\"demo\"}",
      size: 15,
    }));

    await renderFilesPanel();

    expect(await screen.findByRole("button", { name: /package\.json/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("代码 · JSON · 15 B")).toBeInTheDocument();
      expect(document.querySelector(".files-main__code-content")?.textContent).toBe("{\"name\":\"demo\"}");
    });
    expect(getRepoFilePreview).toHaveBeenCalledWith("LiliaGithub", "package.json");
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
    expect(screen.getByRole("button", { name: /main\.ts/ })).toHaveTextContent("M");
    expect(screen.getByRole("button", { name: /App\.vue/ })).toHaveTextContent("W");
    expect(screen.getByRole("button", { name: /README\.md/ })).toHaveTextContent("U");
    expect(screen.getByRole("button", { name: /pnpm-workspace\.yaml/ })).toBeInTheDocument();
  });

  it("本地文件右键菜单执行打开和复制操作", async () => {
    listRepoFiles.mockResolvedValueOnce([file("README.md", "README.md")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "README.md",
      name: "README.md",
      previewKind: "markdown",
      content: "# Guide",
      size: 7,
    }));

    await renderFilesPanel();
    const row = await screen.findByRole("button", { name: /README\.md/ });

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "打开" }));
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("C:\\Files\\workspace\\LiliaGithub\\README.md"));

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "打开所在文件夹" }));
    await waitFor(() => expect(openPathTarget).toHaveBeenCalledWith("C:\\Files\\workspace\\LiliaGithub", "folder"));

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "复制相对路径" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("README.md"));

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "复制完整路径" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("C:\\Files\\workspace\\LiliaGithub\\README.md"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("确认删除当前文件后刷新文件树并选择同目录下一个文件", async () => {
    listRepoFiles
      .mockResolvedValueOnce([file("README.md", "README.md"), file("package.json", "package.json")])
      .mockResolvedValueOnce([file("package.json", "package.json")]);
    getRepoFilePreview
      .mockResolvedValueOnce(preview({
        path: "README.md",
        name: "README.md",
        previewKind: "markdown",
        content: "# Guide",
        size: 7,
      }))
      .mockResolvedValueOnce(preview({
        path: "package.json",
        name: "package.json",
        previewKind: "text",
        content: "{\"name\":\"demo\"}",
        size: 15,
      }));

    await renderFilesPanel();
    const row = await screen.findByRole("button", { name: /README\.md/ });

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "确认删除？再点一次" }));

    await waitFor(() => expect(deleteRepoFile).toHaveBeenCalledWith("LiliaGithub", "README.md"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /README\.md/ })).toBeNull());
    expect(screen.getByRole("button", { name: /package\.json/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector(".files-main__code-content")).toHaveTextContent("{\"name\":\"demo\"}");
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("远程文件树不显示本地文件操作菜单", async () => {
    listRepoFiles.mockResolvedValueOnce([file("README.md", "README.md")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "README.md",
      name: "README.md",
      previewKind: "markdown",
      content: "# Remote",
      size: 8,
    }));

    await renderFilesPanel({
      repoId: "github:sena-nana/remote-repo",
      repoPath: null,
      repoRef: "main",
    });
    expect(screen.queryByRole("menu")).toBeNull();
    await fireEvent.contextMenu(await screen.findByRole("button", { name: /README\.md/ }));

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(deleteRepoFile).not.toHaveBeenCalled();
  });

  it("文本文件显示原始文本预览", async () => {
    listRepoFiles.mockResolvedValueOnce([file("notes.txt")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "notes.txt",
      name: "notes.txt",
      previewKind: "text",
      content: "line 1\nline 2",
      size: 12,
    }));

    await renderFilesPanel();

    await waitFor(() => {
      expect(document.querySelector(".files-main__code")?.textContent).toBe("line 1\nline 2");
    });
    expect(screen.getByText("文本 · 12 B")).toBeInTheDocument();
  });

  it("快速切换文件时只显示最后选中的预览", async () => {
    const firstPreview = deferred<RepoFilePreview>();
    const secondPreview = deferred<RepoFilePreview>();
    listRepoFiles.mockResolvedValueOnce([file("first.txt"), file("second.txt")]);
    getRepoFilePreview
      .mockReturnValueOnce(firstPreview.promise)
      .mockReturnValueOnce(secondPreview.promise);

    await renderFilesPanel();

    await fireEvent.click(await screen.findByRole("button", { name: /second\.txt/ }));
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

  it("代码文本预览显示代码类型和内容", async () => {
    listRepoFiles.mockResolvedValueOnce([file("main.ts")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "main.ts",
      name: "main.ts",
      previewKind: "text",
      content: "export const title = \"Lilia\";\nconst count = 1;",
      size: 29,
    }));

    await renderFilesPanel();
    expect(await screen.findByRole("button", { name: /main\.ts/ })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("代码 · TypeScript · 29 B")).toBeInTheDocument();
      expect(document.querySelector(".files-main__code")).toHaveTextContent("export const title = \"Lilia\";");
      expect(document.querySelector(".files-main__code")).toHaveTextContent("const count = 1;");
    });
  });

  it("YAML 文本预览显示代码类型", async () => {
    listRepoFiles.mockResolvedValueOnce([file("pnpm-workspace.yaml")]);
    getRepoFilePreview.mockResolvedValueOnce(preview({
      path: "pnpm-workspace.yaml",
      name: "pnpm-workspace.yaml",
      previewKind: "text",
      content: "packages:\n  - apps/*",
      size: 20,
    }));

    await renderFilesPanel();

    expect(await screen.findByRole("button", { name: /pnpm-workspace\.yaml/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("代码 · YAML · 20 B")).toBeInTheDocument();
      expect(document.querySelector(".files-main__code-content")).toHaveTextContent("packages:");
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

    expect(await screen.findByText("暂不支持预览")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /huge\.log/ }));
    await waitFor(() => {
      expect(screen.getByText("文件过大")).toBeInTheDocument();
    });
  });
});
