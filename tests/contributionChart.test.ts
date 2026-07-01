import { describe, expect, it } from "vitest";
import type { GitHubContributionDay } from "../src/services/workspace";
import {
  buildContributionChartHtml,
  buildContributionChartModel,
  type ContributionCell,
} from "../src/utils/contributionChart";

describe("contributionChart", () => {
  it("escapes static chart HTML without creating injected nodes", () => {
    const title = "2026-06-01\"><script>alert(1)</script>: 3 次提交";
    const html = buildContributionChartHtml(
      [[
        {
          date: "2026-06-01",
          level: 2,
          weekStart: "2026-06-01",
          title,
        } satisfies ContributionCell,
      ]],
      [{ key: "2026-06-01\"><img src=x>", label: "6<月&\"" }],
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelectorAll("script,img")).toHaveLength(0);
    expect(container.querySelector(".contribution-month")?.textContent).toBe("6<月&\"");
    expect(container.querySelector(".contribution-month")?.getAttribute("data-key")).toBe("2026-06-01\"><img src=x>");
    expect(container.querySelector(".contribution-day")?.getAttribute("aria-label")).toBe(title);
    expect(container.querySelector(".contribution-day")?.getAttribute("title")).toBe(title);
  });

  it("builds static day cells, levels and month labels from contribution days", () => {
    const days: GitHubContributionDay[] = [
      {
        date: "2026-06-01",
        count: 2,
        repositories: [{ repoId: "bad", repoName: "<unsafe>", repoFullName: "org/<unsafe>", count: 2 }],
      },
      { date: "2026-06-03", count: 8 },
    ];
    const model = buildContributionChartModel(days);
    const container = document.createElement("div");
    container.innerHTML = model.html;

    expect(container.querySelectorAll(".contribution-day")).toHaveLength(7);
    expect(container.querySelectorAll(".contribution-day--1")).toHaveLength(1);
    expect(container.querySelectorAll(".contribution-day--4")).toHaveLength(1);
    expect(container.querySelector(".contribution-month")?.textContent).toBe("6月");
    expect(container.querySelector("[aria-label='2026-06-01：2 次提交']")).not.toBeNull();
    expect(model.html).not.toContain("<unsafe>");
  });
});
