import { render, screen } from "@testing-library/vue";
import { CircleDot } from "@lucide/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import GitHubTimelineList, { type TimelineDisplayNode } from "../src/components/GitHubTimelineList.vue";

function node(overrides: Partial<TimelineDisplayNode>): TimelineDisplayNode {
  return {
    id: "node",
    icon: CircleDot,
    title: "节点",
    detail: "节点详情",
    summary: "节点摘要",
    timestamp: Date.UTC(2026, 5, 10, 8),
    datetime: "2026-06-10T08:00:00.000Z",
    timeLabel: "刚刚",
    link: { kind: "none" },
    ...overrides,
  };
}

function renderTimeline(nodes: TimelineDisplayNode[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/repos/:id",
        component: { template: "<div />" },
      },
    ],
  });

  return render(GitHubTimelineList, {
    props: {
      nodes,
    },
    global: {
      plugins: [router],
    },
  });
}

describe("GitHubTimelineList", () => {
  it("renders external, route and plain timeline nodes", () => {
    renderTimeline([
      node({
        id: "external",
        title: "外链节点",
        link: { kind: "external", href: "https://github.com/sena-nana/LiliaGithub" },
      }),
      node({
        id: "route",
        title: "路由节点",
        link: { kind: "route", to: "/repos/LiliaGithub" },
        tone: "ok",
      }),
      node({
        id: "plain",
        title: "纯文本节点",
      }),
    ]);

    const external = screen.getByRole("link", { name: "外链节点" });
    expect(external).toHaveAttribute("href", "https://github.com/sena-nana/LiliaGithub");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noreferrer");

    const route = screen.getByRole("link", { name: "路由节点" });
    expect(route).toHaveAttribute("href", "/repos/LiliaGithub");

    expect(screen.getByText("纯文本节点")).toBeInTheDocument();
  });
});
