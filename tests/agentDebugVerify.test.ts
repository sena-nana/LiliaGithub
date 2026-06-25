import { describe, expect, it } from "vitest";
import { assertNoMissingAgentIds } from "../agent-debug/verify-agent-debug.mjs";

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
});
