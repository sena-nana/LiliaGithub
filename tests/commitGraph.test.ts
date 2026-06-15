import { describe, expect, it } from "vitest";
import type { CommitSummary } from "../src/services/workspace";
import { buildCommitGraph } from "../src/utils/commitGraph";

function commit(hash: string, parents: string[] = [], refs: string[] = []): CommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: "Sena",
    authorEmail: "sena@example.com",
    timestamp: 1,
    subject: hash,
    parents,
    refs,
  };
}

function expectRowsInBounds(rows: ReturnType<typeof buildCommitGraph>) {
  for (const row of rows) {
    expect(row.node.lane).toBeGreaterThanOrEqual(0);
    expect(row.node.lane).toBeLessThan(row.laneCount);
    expect(["commit", "merge", "root"]).toContain(row.node.iconType);
    expect(row.maxLaneCount).toBeGreaterThanOrEqual(row.laneCount);
    for (const line of [...row.topLine, ...row.bottomLine]) {
      expect(line.lane).toBeGreaterThanOrEqual(0);
      expect(line.lane).toBeLessThan(row.laneCount);
      expect(line.color).toMatch(/^#/);
      expect(typeof line.hidden).toBe("boolean");
      expect(line.role === "top" || line.role === "bottom").toBe(true);
      for (const targetLane of line.targetLanes) {
        expect(targetLane).toBeGreaterThanOrEqual(0);
        expect(targetLane).toBeLessThan(row.laneCount);
      }
    }
    const lineIds = [...row.topLine, ...row.bottomLine].map((line) => line.id);
    expect(new Set(lineIds).size).toBe(lineIds.length);
  }
}

describe("buildCommitGraph", () => {
  it("keeps a single lane for linear history", () => {
    const rows = buildCommitGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a")]);

    expect(rows.map((row) => row.nodeLane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.laneCount)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.maxLaneCount)).toEqual([1, 1, 1]);
    expect(rows.map((row) => row.node.iconType)).toEqual(["commit", "commit", "root"]);
    expect(rows[0].topLine).toEqual([
      { id: "0:top:0:", hidden: true, lane: 0, targetLanes: [], color: "#3b82f6", role: "top" },
    ]);
    expect(rows[0].bottomLine).toEqual([
      { id: "0:bottom:0:", hidden: false, lane: 0, targetLanes: [], color: "#3b82f6", role: "bottom" },
    ]);
    expect(rows[2].bottomLine).toEqual([]);
    expectRowsInBounds(rows);
  });

  it("draws merge lanes for commits with multiple parents", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "feature"], ["HEAD -> main", "origin/main"]),
      commit("main", ["root"]),
      commit("feature", ["root"], ["feature"]),
      commit("root"),
    ]);

    expect(rows[0].laneCount).toBe(2);
    expect(rows[0].node.iconType).toBe("merge");
    expect(rows[0].topLine).toContainEqual({
      id: "0:top:0:",
      hidden: true,
      lane: 0,
      targetLanes: [],
      color: "#3b82f6",
      role: "top",
    });
    expect(rows[0].bottomLine).toContainEqual({
      id: "0:bottom:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: "#22a06b",
      role: "bottom",
    });
    expect(rows[2].bottomLine).toContainEqual({
      id: "2:bottom:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "bottom",
    });
    expect(rows[3].topLine).toContainEqual({
      id: "3:top:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: "#22a06b",
      role: "top",
    });
    expect(rows[3].topLine).not.toContainEqual({
      id: "3:top:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "top",
    });
    expect(rows[3].node.iconType).toBe("root");
    expect(rows[0].commit.refs).toEqual(["HEAD -> main", "origin/main"]);
    expectRowsInBounds(rows);
  });

  it("does not draw a bottom segment under a branch node that rejoins an active parent lane", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "feature"]),
      commit("main", ["root"]),
      commit("feature", ["root"]),
      commit("root"),
    ]);

    const branchRow = rows[2];
    expect(branchRow.node).toEqual({ lane: 1, color: "#22a06b", iconType: "commit" });
    expect(branchRow.bottomLine).toContainEqual({
      id: "2:bottom:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "bottom",
    });
    expect(branchRow.topLine).toContainEqual({
      id: "2:top:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "top",
    });
    expectRowsInBounds(rows);
  });

  it("keeps branch colors stable while parallel lanes move through the graph", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main-2", "feature-2"]),
      commit("main-2", ["main-1"]),
      commit("feature-2", ["feature-1"]),
      commit("main-1", ["root"]),
      commit("feature-1", ["root"]),
      commit("root"),
    ]);

    const featureColor = rows[0].bottomLine.find((line) => line.targetLanes.includes(1))?.color;
    expect(featureColor).toBe("#22a06b");
    expect(rows[2].node).toEqual({ lane: 1, color: featureColor, iconType: "commit" });
    expect(rows[4].node).toEqual({ lane: 1, color: featureColor, iconType: "commit" });
    expect(rows[4].bottomLine).toContainEqual({
      id: "4:bottom:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: featureColor,
      role: "bottom",
    });
    expect(rows[5].topLine).toContainEqual({
      id: "5:top:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: featureColor,
      role: "top",
    });
    expect(rows[5].topLine).not.toContainEqual(expect.objectContaining({ lane: 1, targetLanes: [] }));
    expectRowsInBounds(rows);
  });

  it("keeps outer branch lanes stable after an inner branch rejoins", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "inner", "outer"]),
      commit("main", ["base"]),
      commit("inner", ["base"]),
      commit("base", ["root"]),
      commit("outer", ["outer-root"]),
      commit("outer-root"),
      commit("root"),
    ]);

    expect(rows[0].bottomLine.filter((line) => line.targetLanes.length).flatMap((line) => line.targetLanes)).toEqual([1, 2]);
    expect(rows[2].node).toEqual({ lane: 1, color: "#22a06b", iconType: "commit" });
    expect(rows[3].topLine).toContainEqual({
      id: "3:top:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: "#22a06b",
      role: "top",
    });
    expect(rows[3].bottomLine).toContainEqual({
      id: "3:bottom:2:",
      hidden: false,
      lane: 2,
      targetLanes: [],
      color: "#d97706",
      role: "bottom",
    });
    expect(rows[4].node).toEqual({ lane: 2, color: "#d97706", iconType: "commit" });
    expectRowsInBounds(rows);
  });

  it("keeps both parent connections when a merged branch continues afterward", () => {
    const rows = buildCommitGraph([
      commit("continued", ["merged-parent"]),
      commit("merge", ["main-parent", "merged-parent"]),
      commit("main-parent", ["main-root"]),
      commit("merged-parent", ["merged-root"]),
      commit("main-root", ["root"]),
      commit("merged-root", ["root"]),
      commit("root"),
    ]);

    expect(rows[1].node).toEqual({ lane: 1, color: "#22a06b", iconType: "merge" });
    expect(rows[1].bottomLine).toContainEqual({
      id: "1:bottom:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "bottom",
    });
    expect(rows[1].bottomLine).toContainEqual({
      id: "1:bottom:1:0",
      hidden: false,
      lane: 1,
      targetLanes: [0],
      color: "#3b82f6",
      role: "bottom",
    });
    expect(rows[3].topLine).toContainEqual({
      id: "3:top:0:",
      hidden: false,
      lane: 0,
      targetLanes: [],
      color: "#3b82f6",
      role: "top",
    });
    expectRowsInBounds(rows);
  });

  it("keeps an already-active merge parent lane continuous", () => {
    const rows = buildCommitGraph([
      commit("child", ["merge"]),
      commit("side-child", ["side-parent"]),
      commit("merge", ["main-parent", "side-parent"]),
      commit("side-parent", ["shared-root"]),
      commit("main-parent", ["shared-root"]),
      commit("shared-root"),
    ]);

    expect(rows[2].node).toEqual({ lane: 0, color: "#3b82f6", iconType: "merge" });
    expect(rows[2].topLine).toContainEqual({
      id: "2:top:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "top",
    });
    expect(rows[2].bottomLine).toContainEqual({
      id: "2:bottom:1:",
      hidden: false,
      lane: 1,
      targetLanes: [],
      color: "#22a06b",
      role: "bottom",
    });
    expect(rows[2].bottomLine).toContainEqual({
      id: "2:bottom:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: "#22a06b",
      role: "bottom",
    });
    expectRowsInBounds(rows);
  });

  it("releases merged lanes at the shared root commit", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "feature"]),
      commit("main", ["root"]),
      commit("feature", ["root"]),
      commit("root"),
      commit("unrelated-root"),
    ]);

    expect(rows[3].laneCount).toBe(2);
    expect(rows[3].topLine).toContainEqual({
      id: "3:top:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: "#22a06b",
      role: "top",
    });
    expect(rows[3].topLine).not.toContainEqual(expect.objectContaining({ lane: 1, targetLanes: [] }));
    expect(rows[3].bottomLine.length).toBe(0);
    expect(rows[4].nodeLane).toBe(0);
    expect(rows[4].laneCount).toBe(1);
    expectRowsInBounds(rows);
  });

  it("keeps dangling lines for parents outside the truncated history", () => {
    const rows = buildCommitGraph([commit("visible", ["missing-parent"])]);

    expect(rows[0].laneCount).toBe(1);
    expect(rows[0].topLine).toEqual([
      { id: "0:top:0:", hidden: true, lane: 0, targetLanes: [], color: "#3b82f6", role: "top" },
    ]);
    expect(rows[0].bottomLine).toEqual([
      { id: "0:bottom:0:", hidden: false, lane: 0, targetLanes: [], color: "#3b82f6", role: "bottom" },
    ]);
    expectRowsInBounds(rows);
  });

  it("keeps octopus merge lines unique and in bounds", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "feature-a", "feature-b"]),
      commit("main", ["root"]),
      commit("feature-a", ["root"]),
      commit("feature-b", ["root"]),
      commit("root"),
    ]);

    expect(rows[0].laneCount).toBe(3);
    expect(rows[0].node.iconType).toBe("merge");
    expect(rows[0].bottomLine.filter((line) => line.targetLanes.length).flatMap((line) => line.targetLanes)).toEqual([1, 2]);
    expect(rows[4].topLine.filter((line) => line.targetLanes.length).flatMap((line) => line.targetLanes)).toEqual([1, 2]);
    expect(rows[4].topLine).not.toContainEqual(expect.objectContaining({ lane: 1, targetLanes: [] }));
    expect(rows[4].topLine).not.toContainEqual(expect.objectContaining({ lane: 2, targetLanes: [] }));
    expectRowsInBounds(rows);
  });

  it("keeps joined parent lines colored by their target branch lane", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "feature-a", "feature-b"]),
      commit("main", ["main-next", "feature-a"]),
      commit("main-next", ["root"]),
      commit("feature-a", ["root"]),
      commit("feature-b", ["root"]),
      commit("root"),
    ]);

    expect(rows[1].node).toEqual({ lane: 0, color: "#3b82f6", iconType: "merge" });
    expect(rows[1].bottomLine).toContainEqual({
      id: "1:bottom:0:",
      hidden: false,
      lane: 0,
      targetLanes: [],
      color: "#3b82f6",
      role: "bottom",
    });
    expect(rows[1].bottomLine).toContainEqual({
      id: "1:bottom:0:1",
      hidden: false,
      lane: 0,
      targetLanes: [1],
      color: "#22a06b",
      role: "bottom",
    });
    expectRowsInBounds(rows);
  });
});
