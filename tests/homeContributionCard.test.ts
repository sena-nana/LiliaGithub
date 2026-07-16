import { fireEvent, render, screen } from "@testing-library/vue";
import { buildCalendarHeatmapModel } from "@lilia/ui/utils/calendarHeatmap";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import HomeContributionCard from "../src/components/home/HomeContributionCard.vue";

describe("HomeContributionCard", () => {
  it("展示贡献总数、跳过仓库入口和贡献图", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/settings", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();

    render(HomeContributionCard, {
      global: {
        plugins: [router],
      },
      props: {
        loading: false,
        error: null,
        totalContributions: 1,
        skippedRepoCount: 2,
        skippedRepoActionTo: {
          path: "/settings",
          query: { tab: "repositories" },
          hash: "#contribution-identity-list-title",
        },
        hasContributionDays: true,
        chartModel: buildCalendarHeatmapModel([{ date: "2026-06-11", value: 1 }]),
      },
    });

    expect(screen.getByText("1 次提交，最近一年")).toBeInTheDocument();
    expect(screen.getByText(/^已跳过 2 个不可读取仓库/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "处理" })).toHaveAttribute(
      "href",
      "/settings?tab=repositories#contribution-identity-list-title",
    );
    expect(screen.getByRole("img", { name: "本地提交贡献图" })).toBeInTheDocument();
  });

  it("处理入口可切换为父级扫描动作", async () => {
    const view = render(HomeContributionCard, {
      props: {
        loading: false,
        error: null,
        totalContributions: 0,
        skippedRepoCount: 1,
        skippedRepoActionButton: true,
        hasContributionDays: false,
        chartModel: buildCalendarHeatmapModel([]),
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "处理" }));

    expect(view.emitted("resolveSkipped")).toHaveLength(1);
  });
});
