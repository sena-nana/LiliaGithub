import { render, screen } from "@testing-library/vue";
import { buildContributionHeatmapModel } from "@lilia/ui";
import { describe, expect, it } from "vitest";
import HomeContributionCard from "../src/components/home/HomeContributionCard.vue";

describe("HomeContributionCard", () => {
  it("展示贡献总数、跳过仓库统计和贡献图", () => {
    render(HomeContributionCard, {
      props: {
        loading: false,
        error: null,
        totalContributions: 1,
        skippedRepoCount: 2,
        hasContributionDays: true,
        chartModel: buildContributionHeatmapModel([{ date: "2026-06-11", count: 1 }]),
      },
    });

    expect(screen.getByText("1 次提交，最近一年")).toBeInTheDocument();
    expect(screen.getByText("已跳过 2 个不可读取仓库")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "本地提交贡献图" })).toBeInTheDocument();
  });
});
