import { fireEvent, render } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import RepoHistoryPanel from "../src/components/repo/RepoHistoryPanel.vue";
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

describe("RepoHistoryPanel", () => {
  it("renders multi-lane topology and keeps commit open behavior", async () => {
    const commits = [
      commit("merge", ["main", "feature"], ["HEAD -> main", "origin/main"]),
      commit("main", ["root"]),
      commit("feature", ["root"], ["feature"]),
      commit("root"),
    ];
    const view = render(RepoHistoryPanel, {
      props: {
        commits,
        commitMetaTitle: (item: CommitSummary) => item.hash,
      },
    });

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

    expect(view.emitted("openCommit")?.[0]).toEqual([commits[0]]);
  });

  it("renders dangling and octopus graph geometry without invalid coordinates", () => {
    const commits = [
      commit("octopus", ["main", "feature-a", "missing-parent"]),
      commit("main", ["root"]),
      commit("feature-a", ["root"]),
      commit("root"),
    ];
    const view = render(RepoHistoryPanel, {
      props: {
        commits,
        commitMetaTitle: (item: CommitSummary) => item.hash,
      },
    });

    expect(view.container.querySelectorAll(".history-graph__connector").length).toBeGreaterThanOrEqual(2);
    expect(view.container.querySelectorAll(".history-graph__node")).toHaveLength(4);
    expectValidGraphGeometry(view.container);
  });
});
