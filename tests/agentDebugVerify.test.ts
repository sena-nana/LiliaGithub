import { describe, expect, it } from "vitest";
import {
  assertNoMissingAgentIds,
  findEnabledVisibleAgentId,
  findHomePendingOpenTarget,
} from "../agent-debug/verify-agent-debug.mjs";

describe("agent debug verify script", () => {
  it("fails a regression step when missing agent ids are present", () => {
    expect(() =>
      assertNoMissingAgentIds(
        {
          missingAgentIds: [
            {
              role: "button",
              text: "刷新 Release",
              tagName: "button",
              selector: "button",
              rect: { x: 0, y: 0, width: 80, height: 28 },
              nearestAgentId: "repo.release",
            },
          ],
        },
        "release-panel",
      ),
    ).toThrow("release-panel has 1 missing agent ids");
  });

  it("allows a regression step with a fully addressable snapshot", () => {
    expect(() => assertNoMissingAgentIds({ missingAgentIds: [] }, "settings-about")).not.toThrow();
  });

  it("only selects optional profile actions that are visible and enabled", () => {
    expect(findEnabledVisibleAgentId([
      { id: "profile.edit", visible: true, disabled: true },
      { id: "profile.cancel", visible: false, disabled: false },
    ], ["profile.edit", "profile.cancel"])).toBeNull();

    expect(findEnabledVisibleAgentId([
      { agentId: "profile.edit", visible: true, disabled: false },
    ], ["profile.edit"])).toBe("profile.edit");
  });

  it("selects the first visible enabled home pending deep link", () => {
    expect(findHomePendingOpenTarget([
      { id: "home.pending.conflict.repo-a.open", visible: false, disabled: false },
      { id: "home.pending.workflow.repo-b.open", visible: true, disabled: true },
      { id: "home.pending.pull.repo-c", visible: true, disabled: false },
      { agentId: "home.pending.pull.repo-c.open", visible: true, disabled: false },
      { id: "repo.pulls.7.open", visible: true, disabled: false },
    ])).toBe("home.pending.pull.repo-c.open");
  });
});
