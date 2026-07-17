import { fireEvent, render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import DiscoveryPanel from "../src/components/discovery/DiscoveryPanel.vue";
import PullRequestReviewDialog from "../src/components/discovery/PullRequestReviewDialog.vue";

describe("跨仓库工作台 UI", () => {
  it("保留已有结果并把部分失败作为可恢复状态", async () => {
    const view = render(DiscoveryPanel, {
      props: {
        title: "被分配的 Issues",
        agentId: "discovery.issue",
        itemCount: 2,
        failureCount: 1,
        error: "刷新失败",
        emptyMessage: "没有 Issue",
      },
      slots: { default: "<div>已有结果</div>" },
    });

    expect(screen.getByText("已有结果")).toBeInTheDocument();
    expect(screen.getByText("1 个仓库暂时无法读取。")).toBeInTheDocument();
    expect(screen.queryByText("没有 Issue")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(view.emitted("retry")).toHaveLength(1);
  });

  it("请求修改必须填写说明并提交结构化审查请求", async () => {
    const view = render(PullRequestReviewDialog, {
      props: { open: true, pullTitle: "修复同步竞态" },
    });
    const eventSelect = screen.getByLabelText("审查结果");
    await fireEvent.update(eventSelect, "request_changes");
    await fireEvent.click(screen.getByRole("button", { name: "提交审查" }));
    expect(view.emitted("submit")).toBeUndefined();
    expect(screen.getByRole("alert")).toHaveTextContent("需要填写说明");

    await fireEvent.update(screen.getByLabelText("说明（必填）"), "请先补充边界测试");
    await fireEvent.click(screen.getByRole("button", { name: "提交审查" }));
    expect(view.emitted("submit")).toEqual([[{
      event: "request_changes",
      body: "请先补充边界测试",
    }]]);
  });
});
