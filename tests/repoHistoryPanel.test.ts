import { fireEvent, render, screen } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContextMenuHost from "../src/components/ContextMenuHost.vue";
import RepoHistoryPanel from "../src/components/repo/RepoHistoryPanel.vue";
import { closeContextMenu, installContextMenu } from "../src/composables/useContextMenu";
import { vContextMenu } from "../src/directives/contextMenu";
import type { CommitSummary } from "../src/services/workspace";

function commit(hash: string, parents: string[] = [], refs: string[] = []): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: "Sena",
    authorEmail: "sena@example.com",
    timestamp: 1_785_000_000,
    subject: hash,
    parents,
    refs,
  };
}

function expectValidGraphGeometry(container: HTMLElement) {
  const graphElements = container.querySelectorAll(".history-graph__connector, .history-graph__node");
  expect(graphElements.length).toBeGreaterThan(0);

  for (const element of graphElements) {
    for (const attribute of ["x1", "x2", "y1", "y2", "cx", "cy", "d"]) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      expect(value).not.toContain("NaN");
      expect(value).not.toContain("-Infinity");
      expect(value).not.toContain("Infinity");
      if (attribute !== "d") expect(Number(value)).toBeGreaterThanOrEqual(0);
    }
  }
}

function renderHistoryPanel(props: {
  commits: CommitSummary[];
  commitMetaTitle?: (commit: CommitSummary) => string;
  selectedCommitHash?: string | null;
  readOnly?: boolean;
}) {
  const handlers = {
    openCommit: vi.fn(),
    cherryPickCommit: vi.fn(),
    revertCommit: vi.fn(),
    resetCommit: vi.fn(),
    createBranchFromCommit: vi.fn(),
  };
  const resolvedProps = {
    commitMetaTitle: (item: CommitSummary) => item.hash,
    selectedCommitHash: null,
    ...props,
  };

  render(ContextMenuHost);
  const view = render(RepoHistoryPanel, {
    props: {
      ...resolvedProps,
      onOpenCommit: handlers.openCommit,
      onCherryPickCommit: handlers.cherryPickCommit,
      onRevertCommit: handlers.revertCommit,
      onResetCommit: handlers.resetCommit,
      onCreateBranchFromCommit: handlers.createBranchFromCommit,
    },
    global: {
      directives: {
        contextMenu: vContextMenu,
      },
    },
  });
  return { ...view, handlers };
}

describe("RepoHistoryPanel", () => {
  beforeEach(() => {
    closeContextMenu();
    installContextMenu();
  });

  afterEach(() => {
    closeContextMenu();
    vi.restoreAllMocks();
  });

  it("renders multi-lane topology and keeps commit open behavior", async () => {
    const commits = [
      commit("merge", ["main", "feature"], ["HEAD -> main", "origin/main"]),
      commit("main", ["root"]),
      commit("feature", ["root"], ["feature"]),
      commit("root"),
    ];
    const view = renderHistoryPanel({ commits });

    const connector = Array.from(view.container.querySelectorAll(".history-graph__connector")).find(
      (element) => element.getAttribute("stroke") === "#22a06b",
    );
    expect(view.container.querySelectorAll(".history-graph__svg")).toHaveLength(4);
    expect(view.container.querySelectorAll(".history-graph__node")).toHaveLength(4);
    expect(view.container.querySelector(".history-graph__node--merge")).toBeInstanceOf(Element);
    expect(view.container.querySelector(".history-graph__node--root")).toBeInstanceOf(Element);
    expect(connector).toBeInstanceOf(Element);
    expect(connector).toHaveAttribute("d", expect.stringContaining(" C "));
    expect(connector).toHaveAttribute("d", expect.stringContaining("28"));
    expect(connector).toHaveAttribute("stroke", "#22a06b");
    expect(view.container.querySelector(".repo-panel--history")).toBeInstanceOf(HTMLElement);
    expect(view.container.querySelector(".history-list")).toHaveAttribute("style", expect.stringContaining("--history-graph-width"));
    expect(view.getByText("HEAD -> main")).toBeInTheDocument();
    expect(view.getByText("origin/main")).toBeInTheDocument();
    expect(view.getAllByText("Sena").length).toBeGreaterThan(0);
    expect(view.getAllByText("feature").length).toBeGreaterThan(0);
    expectValidGraphGeometry(view.container);

    await fireEvent.click(view.getByRole("button", { name: /merge/ }));

    expect(view.handlers.openCommit).toHaveBeenCalledWith(commits[0]);
  });

  it("renders dangling and octopus graph geometry without invalid coordinates", () => {
    const commits = [
      commit("octopus", ["main", "feature-a", "missing-parent"]),
      commit("main", ["root"]),
      commit("feature-a", ["root"]),
      commit("root"),
    ];
    const view = renderHistoryPanel({ commits });

    expect(view.container.querySelectorAll(".history-graph__connector").length).toBeGreaterThanOrEqual(2);
    expect(view.container.querySelectorAll(".history-graph__node")).toHaveLength(4);
    expectValidGraphGeometry(view.container);
  });

  it("marks the selected commit without rendering detail content", async () => {
    const commits = [commit("1234567890abcdef")];
    const view = renderHistoryPanel({
      commits,
      selectedCommitHash: commits[0].hash,
    });

    expect(view.getByRole("button", { name: /1234567890abcdef/ })).toHaveClass("is-active");
    expect(view.queryByLabelText("提交详情卡片")).toBeNull();
  });

  it("shows commit actions in the row context menu and emits the selected operation", async () => {
    const commits = [commit("1234567890abcdef")];
    const view = renderHistoryPanel({ commits });
    const row = view.getByRole("button", { name: /1234567890abcdef/ });

    await fireEvent.contextMenu(row);

    expect(await screen.findByRole("menuitem", { name: "拣选提交" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "还原提交" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重置到此提交" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "硬重置到此提交" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "基于此新建分支" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("menuitem", { name: "拣选提交" }));
    expect(view.handlers.cherryPickCommit).toHaveBeenCalledWith(commits[0].hash);

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "还原提交" }));
    expect(view.handlers.revertCommit).toHaveBeenCalledWith(commits[0].hash);

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "重置到此提交" }));
    expect(view.handlers.resetCommit).toHaveBeenCalledWith({ hash: commits[0].hash, mode: "mixed" });

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "硬重置到此提交" }));
    expect(view.handlers.resetCommit).toHaveBeenCalledWith({ hash: commits[0].hash, mode: "hard" });

    await fireEvent.contextMenu(row);
    await fireEvent.click(await screen.findByRole("menuitem", { name: "基于此新建分支" }));
    expect(view.handlers.createBranchFromCommit).toHaveBeenCalledWith(commits[0].hash);
  });

  it("hides local commit actions in read-only history", async () => {
    const commits = [commit("1234567890abcdef")];
    const view = renderHistoryPanel({ commits, readOnly: true });
    const row = view.getByRole("button", { name: /1234567890abcdef/ });

    await fireEvent.contextMenu(row);

    expect(screen.queryByRole("menuitem", { name: "拣选提交" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "还原提交" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "重置到此提交" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "基于此新建分支" })).toBeNull();
  });
});
