import { describe, expect, it } from "vitest";
import type { GitHubWorkflowJob, GitHubWorkflowRunDetail } from "../src/services/workspace/types";
import { buildWorkflowGraph } from "../src/utils/workflowGraph";

function job(id: number, name: string, status = "completed", conclusion: string | null = "success"): GitHubWorkflowJob {
  return {
    id,
    name,
    status,
    conclusion,
    startedAt: "2026-06-18T08:00:00Z",
    completedAt: "2026-06-18T08:01:00Z",
    htmlUrl: null,
    runnerName: "GitHub Actions",
    steps: [],
  };
}

function detail(content: string, jobs: GitHubWorkflowJob[]): GitHubWorkflowRunDetail {
  return {
    run: {
      id: 1,
      name: "CI",
      displayTitle: "CI",
      status: "completed",
      conclusion: "success",
      branch: "main",
      event: "push",
      htmlUrl: "https://github.com/a/repo/actions/runs/1",
      createdAt: "2026-06-18T08:00:00Z",
      updatedAt: "2026-06-18T08:03:00Z",
    },
    jobs,
    artifacts: [],
    workflow: {
      id: 9,
      path: ".github/workflows/ci.yml",
      refName: "abc123",
      content,
    },
  };
}

describe("workflowGraph", () => {
  it("builds a DAG from string and array needs", () => {
    const graph = buildWorkflowGraph(detail(`
jobs:
  lint:
    name: lint
  build:
    name: build
  test:
    name: test
    needs: [lint, build]
  package:
    name: package
    needs: test
`, [job(1, "lint"), job(2, "build"), job(3, "test"), job(4, "package")]));

    expect(graph.nodes.map((node) => [node.job.name, node.column])).toEqual([
      ["lint", 0],
      ["build", 0],
      ["test", 1],
      ["package", 2],
    ]);
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual(["1->3", "2->3", "3->4"]);
  });

  it("keeps unmatched runtime jobs visible without drawing guessed edges", () => {
    const graph = buildWorkflowGraph(detail(`
jobs:
  build:
    name: build
  deploy:
    needs: build
`, [job(1, "build"), job(2, "deploy production")]));

    expect(graph.nodes.map((node) => node.job.name)).toEqual(["build", "deploy production"]);
    expect(graph.edges).toHaveLength(0);
  });

  it("does not match ambiguous workflow labels", () => {
    const graph = buildWorkflowGraph(detail(`
jobs:
  test-a:
    name: test
  test-b:
    name: test
  package:
    needs: [test-a, test-b]
`, [job(1, "test"), job(2, "package")]));

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(0);
  });

  it("falls back to isolated nodes for invalid YAML and cycles", () => {
    const invalid = buildWorkflowGraph(detail("jobs: [", [job(1, "build")]));
    expect(invalid.nodes).toHaveLength(1);
    expect(invalid.edges).toHaveLength(0);

    const cyclic = buildWorkflowGraph(detail(`
jobs:
  a:
    needs: b
  b:
    needs: a
`, [job(1, "a"), job(2, "b")]));
    expect(cyclic.nodes.every((node) => node.column === 0)).toBe(true);
    expect(cyclic.edges).toHaveLength(0);
  });

  it("maps source job status to graph tone", () => {
    const graph = buildWorkflowGraph(detail(`
jobs:
  lint:
    runs-on: ubuntu-latest
  test:
    needs: lint
    runs-on: ubuntu-latest
`, [job(1, "lint", "completed", "failure"), job(2, "test", "queued", null)]));

    expect(graph.nodes[0].tone).toBe("error");
  });
});
