import { render, screen, within } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import RepoDiscussionTimeline from "../src/components/repo/RepoDiscussionTimeline.vue";
import type { GitHubDiscussionTimelineItem } from "../src/services/workspace/types";

function item(overrides: Partial<GitHubDiscussionTimelineItem>): GitHubDiscussionTimelineItem {
  return {
    id: "item",
    kind: "event",
    actor: "sena",
    createdAt: "2026-06-18T08:00:00Z",
    ...overrides,
  };
}

function renderTimeline(items: GitHubDiscussionTimelineItem[]) {
  return render(RepoDiscussionTimeline, {
    props: {
      items,
      loading: false,
      error: null,
      linkBaseUrl: "https://github.com/sena-nana/remote-repo",
    },
  });
}

describe("RepoDiscussionTimeline", () => {
  it("renders discussion item kinds as a compact chronological timeline", () => {
    const view = renderTimeline([
      item({
        id: "review-comment",
        kind: "reviewComment",
        actor: "reviewer",
        body: "这里需要用共享 timeline 组件渲染。",
        path: "src/components/repo/RepoProjectPanel.vue",
        line: 128,
        createdAt: "2026-06-18T08:04:00Z",
      }),
      item({
        id: "body",
        kind: "body",
        actor: "author",
        body: "初始描述",
        createdAt: "2026-06-18T08:00:00Z",
      }),
      item({
        id: "comment",
        kind: "comment",
        actor: "commenter",
        body: "已确认，需要展示 **Markdown** 评论。",
        createdAt: "2026-06-18T08:02:00Z",
      }),
      item({
        id: "event",
        kind: "event",
        actor: "author",
        title: "添加了标签",
        event: "labeled",
        createdAt: "2026-06-18T08:01:00Z",
      }),
      item({
        id: "review",
        kind: "review",
        actor: "reviewer",
        state: "APPROVED",
        body: "整体方向可以。",
        createdAt: "2026-06-18T08:03:00Z",
      }),
    ]);

    const rows = Array.from(view.container.querySelectorAll(".discussion-timeline__item"));
    const list = view.container.querySelector(".discussion-timeline__list");
    expect(rows).toHaveLength(5);
    expect(list).toBeInstanceOf(HTMLOListElement);
    expect(list?.children).toHaveLength(5);
    expect(rows.map((row) => row.className)).toEqual([
      expect.stringContaining("is-body"),
      expect.stringContaining("is-event"),
      expect.stringContaining("is-comment"),
      expect.stringContaining("is-review"),
      expect.stringContaining("is-reviewComment"),
    ]);

    expect(within(rows[0] as HTMLElement).getByText("描述")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("添加了标签")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("评论")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Markdown")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText("Review · APPROVED")).toBeInTheDocument();
    expect(within(rows[4] as HTMLElement).getByText("Review comment")).toBeInTheDocument();
    expect(within(rows[4] as HTMLElement).getByText(/RepoProjectPanel\.vue:128/)).toBeInTheDocument();

    const entryRows = [rows[0], rows[2], rows[3], rows[4]];
    for (const row of entryRows) {
      const entry = row?.querySelector(".discussion-timeline__entry");
      expect(entry).toBeInstanceOf(HTMLElement);
      expect(entry?.querySelector(".readme-render")).toBeInstanceOf(HTMLElement);
    }
    expect(rows[1]?.querySelector(".discussion-timeline__event-row")).toBeInstanceOf(HTMLElement);
    expect(rows[1]?.querySelector(".discussion-timeline__entry")).toBeNull();
  });

  it("keeps loading, error and empty states", () => {
    const loadingView = render(RepoDiscussionTimeline, {
      props: { items: [], loading: true, error: null },
    });
    expect(screen.getByText("正在读取讨论。")).toBeInTheDocument();
    loadingView.unmount();

    const errorView = render(RepoDiscussionTimeline, {
      props: { items: [], loading: false, error: "读取失败" },
    });
    expect(screen.getByText("读取失败")).toBeInTheDocument();
    errorView.unmount();

    render(RepoDiscussionTimeline, {
      props: { items: [], loading: false, error: null, emptyText: "没有讨论" },
    });
    expect(screen.getByText("没有讨论")).toBeInTheDocument();
  });
});
