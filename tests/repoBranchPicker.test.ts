import { fireEvent, render, screen, within } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ContextMenuHost from "../src/components/ContextMenuHost.vue";
import RepoBranchPicker from "../src/components/repo/RepoBranchPicker.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { vContextMenu } from "../src/directives/contextMenu";

const branches = [
  {
    name: "main",
    remote: false,
    current: true,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    protected: false,
    tipTimestamp: 1_785_000_000,
    checkedOutWorktreePaths: ["C:\\Files\\workspace\\LiliaGithub"],
    section: "current" as const,
    relativeTime: "3 天前",
    checkedOutInWorktree: true,
    worktreePathsLabel: "C:\\Files\\workspace\\LiliaGithub",
    searchText: "main origin/main",
  },
  {
    name: "dev",
    remote: false,
    current: false,
    upstream: "origin/dev",
    ahead: 0,
    behind: 0,
    protected: false,
    tipTimestamp: 1_784_998_000,
    checkedOutWorktreePaths: [],
    section: "local" as const,
    relativeTime: "16 小时前",
    checkedOutInWorktree: false,
    worktreePathsLabel: "",
    searchText: "dev origin/dev",
  },
  {
    name: "origin/feature/notice-update",
    remote: true,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    protected: false,
    tipTimestamp: 1_784_200_000,
    checkedOutWorktreePaths: [],
    section: "remote" as const,
    relativeTime: "2 个月前",
    checkedOutInWorktree: false,
    worktreePathsLabel: "",
    searchText: "origin/feature/notice-update",
  },
];

function renderPicker(handlers: Record<string, unknown> = {}) {
  const resolvedHandlers = {
    onCheckout: vi.fn(),
    onUpdateCurrent: vi.fn(),
    onCreateBranch: vi.fn(),
    onRenameBranch: vi.fn(),
    onMergeBranch: vi.fn(),
    onDeleteBranch: vi.fn(),
    ...handlers,
  };
  const Wrapper = defineComponent({
    components: { RepoBranchPicker, ContextMenuHost },
    setup: () => resolvedHandlers,
    template: `
      <RepoBranchPicker
        :branches="branches"
        display-label="main"
        @checkout="onCheckout"
        @update-current="onUpdateCurrent"
        @create-branch="onCreateBranch"
        @rename-branch="onRenameBranch"
        @merge-branch="onMergeBranch"
        @delete-branch="onDeleteBranch"
      />
      <ContextMenuHost />
    `,
    data: () => ({ branches }),
  });

  return render(Wrapper, {
    global: {
      directives: {
        contextMenu: vContextMenu,
      },
    },
  });
}

describe("RepoBranchPicker", () => {
  beforeEach(() => {
    closeContextMenu();
    installContextMenu();
  });

  afterEach(() => {
    closeContextMenu();
    vi.restoreAllMocks();
  });

  it("显示分组、搜索和 worktree 标记", async () => {
    const view = renderPicker();

    await fireEvent.click(screen.getByRole("button", { name: "main" }));

    expect(screen.getByLabelText("搜索分支")).toBeInTheDocument();
    expect(screen.getByText("当前分支")).toBeInTheDocument();
    expect(screen.getByText("本地分支")).toBeInTheDocument();
    expect(screen.getByText("远程分支")).toBeInTheDocument();
    expect(screen.getByText("16 小时前")).toBeInTheDocument();
    expect(view.container.querySelectorAll(".branch-picker__row-worktree svg")).toHaveLength(1);

    await fireEvent.update(screen.getByLabelText("搜索分支"), "notice-update");

    expect(screen.getByRole("button", { name: "origin/feature/notice-update" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "dev" })).toBeNull();
  });

  it("右键菜单按分支类型切换动作", async () => {
    renderPicker();
    await fireEvent.click(screen.getByRole("button", { name: "main" }));
    const listbox = screen.getByRole("listbox", { name: "分支候选" });

    await fireEvent.contextMenu(within(listbox).getByRole("button", { name: "main" }));
    expect(await screen.findByRole("menuitem", { name: "更新" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "创建分支…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重命名…" })).toBeInTheDocument();

    await fireEvent.contextMenu(within(listbox).getByRole("button", { name: "dev" }));
    expect(await screen.findByRole("menuitem", { name: "检出" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "合并到当前分支" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();

    await fireEvent.contextMenu(within(listbox).getByRole("button", { name: "origin/feature/notice-update" }));
    expect(await screen.findByRole("menuitem", { name: "检出" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "基于此创建本地分支…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "合并到当前分支" })).toBeNull();
  });

  it("创建和重命名弹窗发出对应事件", async () => {
    const onCreateBranch = vi.fn();
    const onRenameBranch = vi.fn();
    renderPicker({ onCreateBranch, onRenameBranch });
    await fireEvent.click(screen.getByRole("button", { name: "main" }));
    const listbox = screen.getByRole("listbox", { name: "分支候选" });

    await fireEvent.contextMenu(within(listbox).getByRole("button", { name: "origin/feature/notice-update" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "基于此创建本地分支…" }));
    const createDialog = await screen.findByRole("dialog", { name: "创建分支" });
    const createInputs = within(createDialog).getAllByRole("textbox");
    expect((createInputs[1] as HTMLInputElement).value).toBe("feature/notice-update");
    await fireEvent.update(createInputs[1], "feature/local-copy");
    await fireEvent.click(within(createDialog).getByRole("button", { name: "创建" }));
    expect(onCreateBranch).toHaveBeenCalledWith({
      name: "feature/local-copy",
      fromRef: "origin/feature/notice-update",
      checkoutAfter: true,
    });

    await fireEvent.click(screen.getByRole("button", { name: "main" }));
    const reopenedListbox = await screen.findByRole("listbox", { name: "分支候选" });
    await fireEvent.contextMenu(within(reopenedListbox).getByRole("button", { name: "dev" }));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "重命名…" }));
    const renameDialog = await screen.findByRole("dialog", { name: "重命名分支" });
    const renameInputs = within(renameDialog).getAllByRole("textbox");
    await fireEvent.update(renameInputs[1], "dev-renamed");
    await fireEvent.click(within(renameDialog).getByRole("button", { name: "重命名" }));
    expect(onRenameBranch).toHaveBeenCalledWith({
      oldName: "dev",
      newName: "dev-renamed",
    });
  });
});
