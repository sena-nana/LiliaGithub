import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { CircleDot } from "@lucide/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";
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

async function renderTimeline(nodes: TimelineDisplayNode[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: { template: "<div />" },
      },
      {
        path: "/repos/:id",
        component: { template: "<div />" },
      },
    ],
  });
  await router.push("/");
  await router.isReady();

  const view = render(GitHubTimelineList, {
    props: {
      nodes,
    },
    global: {
      plugins: [router],
    },
  });
  return { ...view, router };
}

describe("GitHubTimelineList", () => {
  it("renders external, route and plain timeline nodes", async () => {
    await renderTimeline([
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

  it("preloads and pushes route links on primary click", async () => {
    const preload = vi.fn(async () => undefined);
    const { router } = await renderTimeline([
      node({
        id: "route",
        title: "路由节点",
        link: { kind: "route", to: "/repos/LiliaGithub", preload },
      }),
    ]);

    await fireEvent.click(screen.getByRole("link", { name: "路由节点" }));

    await waitFor(() => {
      expect(preload).toHaveBeenCalledTimes(1);
      expect(router.currentRoute.value.fullPath).toBe("/repos/LiliaGithub");
    });
  });
});
