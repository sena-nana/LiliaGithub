import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import RepoConflictDialog from "../src/components/repo/RepoConflictDialog.vue";
import type {
  RepoConflictFile,
  RepoConflictHunk,
  RepoConflictState,
} from "../src/services/workspace";

function conflictHunk(id: string, overrides: Partial<RepoConflictHunk> = {}): RepoConflictHunk {
  return {
    id,
    startLine: 1,
    endLine: 3,
    oursLabel: "当前版本",
    theirsLabel: "传入版本",
    oursLines: [`ours-${id}`],
    theirsLines: [`theirs-${id}`],
    ...overrides,
  };
}

function conflictFile(path: string, overrides: Partial<RepoConflictFile> = {}): RepoConflictFile {
  return {
    path,
    status: "UU",
    resolved: false,
    binary: false,
    hunks: [conflictHunk(`${path}-hunk`)],
    ...overrides,
  };
}

function conflictState(overrides: Partial<RepoConflictState> = {}): RepoConflictState {
  return {
    operation: "merge",
    files: [],
    allResolved: false,
    ...overrides,
  };
}

function renderDialog(conflicts: RepoConflictState, overrides: { actionRunning?: boolean; error?: string | null } = {}) {
  return render(RepoConflictDialog, {
    props: {
      open: true,
      conflicts,
      actionRunning: overrides.actionRunning ?? false,
      error: overrides.error ?? null,
    },
    global: { stubs: { transition: false } },
  });
}

function agentTarget(agentId: string) {
  const target = document.querySelector<HTMLElement>(`[data-agent-id="${agentId}"]`);
  expect(target).not.toBeNull();
  return target as HTMLElement;
}

function fileAgentId(path: string) {
  return `repo.conflicts.file.${encodeURIComponent(path)}`;
}

function hunkAgentId(path: string, hunkId: string, side: "ours" | "theirs") {
  return `repo.conflicts.hunk.${encodeURIComponent(path)}.${encodeURIComponent(hunkId)}.${side}`;
}

describe("RepoConflictDialog", () => {
  it("requires every hunk choice, preserves choices across files, and emits the ordered resolve payload", async () => {
    const firstPath = "src/alpha.ts";
    const secondPath = "src/beta.ts";
    const conflicts = conflictState({
      files: [
        conflictFile(firstPath, {
          hunks: [conflictHunk("alpha-1"), conflictHunk("alpha-2", { startLine: 8, endLine: 10 })],
        }),
        conflictFile(secondPath, { hunks: [conflictHunk("beta-1")] }),
      ],
    });
    const view = renderDialog(conflicts);
    const resolveButton = screen.getByRole("button", { name: "解决并暂存" });

    expect(resolveButton).toBeDisabled();
    await fireEvent.click(agentTarget(hunkAgentId(firstPath, "alpha-1", "ours")));
    expect(resolveButton).toBeDisabled();
    await fireEvent.click(agentTarget(hunkAgentId(firstPath, "alpha-2", "theirs")));
    expect(resolveButton).toBeEnabled();

    await fireEvent.click(agentTarget(fileAgentId(secondPath)));
    expect(screen.getByRole("button", { name: "解决并暂存" })).toBeDisabled();
    await fireEvent.click(agentTarget(hunkAgentId(secondPath, "beta-1", "ours")));

    await fireEvent.click(agentTarget(fileAgentId(firstPath)));
    expect(agentTarget(hunkAgentId(firstPath, "alpha-1", "ours"))).toHaveAttribute("aria-pressed", "true");
    expect(agentTarget(hunkAgentId(firstPath, "alpha-2", "theirs"))).toHaveAttribute("aria-pressed", "true");
    await fireEvent.click(screen.getByRole("button", { name: "解决并暂存" }));

    expect(view.emitted("resolveFile")).toEqual([[
      {
        path: firstPath,
        choices: [
          { hunkId: "alpha-1", side: "ours" },
          { hunkId: "alpha-2", side: "theirs" },
        ],
      },
    ]]);
  });

  it("requires a second click before replacing a whole file or aborting the operation", async () => {
    const path = "src/main.ts";
    const view = renderDialog(conflictState({ files: [conflictFile(path)] }));

    await fireEvent.click(screen.getByRole("button", { name: "整文件采用 当前版本" }));
    expect(view.emitted("acceptFile")).toBeUndefined();
    await fireEvent.click(screen.getByRole("button", { name: "确认采用 当前版本" }));
    expect(view.emitted("acceptFile")).toEqual([[{ path, side: "ours" }]]);

    await fireEvent.click(screen.getByRole("button", { name: "终止合并" }));
    expect(view.emitted("abort")).toBeUndefined();
    await fireEvent.click(screen.getByRole("button", { name: "确认终止合并" }));
    expect(view.emitted("abort")).toEqual([[]]);
  });

  it("uses file-level actions for binary and markerless conflicts", async () => {
    const binaryPath = "assets/logo.png";
    const markerlessPath = "src/generated.ts";
    const view = renderDialog(conflictState({
      files: [
        conflictFile(binaryPath, { binary: true }),
        conflictFile(markerlessPath, { hunks: [] }),
      ],
    }));

    expect(screen.getByText("该文件无法作为文本读取，请使用整文件操作或在外部处理。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解决并暂存" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "已在外部处理，标记解决" }));
    expect(view.emitted("markResolved")).toEqual([[binaryPath]]);

    await fireEvent.click(agentTarget(fileAgentId(markerlessPath)));
    expect(screen.getByText("未找到可分段处理的冲突标记，请使用整文件操作或在外部处理。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "解决并暂存" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "整文件采用 ours" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "整文件采用 theirs" })).toBeEnabled();
  });

  it.each([
    ["merge", "完成合并", "终止合并"],
    ["rebase", "继续 rebase", "终止 rebase"],
    ["cherry-pick", "继续 cherry-pick", "终止 cherry-pick"],
  ] as const)("continues a resolved %s operation", async (operation, continueLabel, abortLabel) => {
    const view = renderDialog(conflictState({ operation, files: [], allResolved: true }));
    expect(screen.getByRole("button", { name: abortLabel })).toBeEnabled();
    await fireEvent.click(screen.getByRole("button", { name: continueLabel }));
    expect(view.emitted("continue")).toEqual([[]]);
  });

  it("disables unsupported operation controls", () => {
    renderDialog(conflictState({ operation: "revert", files: [], allResolved: true }));
    expect(screen.getByRole("button", { name: "继续操作" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "终止操作" })).toBeDisabled();
  });

  it("shows operation errors and blocks every close path while an action is pending", async () => {
    const conflicts = conflictState({ files: [conflictFile("src/main.ts")] });
    const view = renderDialog(conflicts, { actionRunning: true, error: "暂存冲突文件失败" });
    const dialog = screen.getByRole("dialog", { name: "合并冲突" });

    expect(screen.getByRole("alert")).toHaveTextContent("暂存冲突文件失败");
    expect(screen.getByRole("button", { name: "关闭冲突处理" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "终止合并" })).toBeDisabled();
    await fireEvent.keyDown(dialog, { key: "Escape" });
    await fireEvent.click(dialog);
    expect(view.emitted("close")).toBeUndefined();

    await view.rerender({ open: true, conflicts, actionRunning: false, error: "暂存冲突文件失败" });
    await fireEvent.click(screen.getByRole("button", { name: "关闭冲突处理" }));
    expect(view.emitted("close")).toEqual([[]]);
  });

  it("closes from Escape or the backdrop and restores the entry focus", async () => {
    const entry = document.createElement("button");
    entry.textContent = "处理冲突入口";
    document.body.appendChild(entry);
    entry.focus();
    const conflicts = conflictState({ files: [conflictFile("src/main.ts")] });
    const view = render(RepoConflictDialog, {
      props: { open: false, conflicts, actionRunning: false, error: null },
      global: { stubs: { transition: false } },
    });

    await view.rerender({ open: true, conflicts, actionRunning: false, error: null });
    const dialog = await screen.findByRole("dialog", { name: "合并冲突" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(view.emitted("close")).toEqual([[]]);
    await view.rerender({ open: false, conflicts, actionRunning: false, error: null });
    await waitFor(() => expect(document.activeElement).toBe(entry));

    entry.focus();
    await view.rerender({ open: true, conflicts, actionRunning: false, error: null });
    const reopenedDialog = await screen.findByRole("dialog", { name: "合并冲突" });
    await fireEvent.click(reopenedDialog);
    expect(view.emitted("close")).toEqual([[], []]);
    entry.remove();
  });
});
