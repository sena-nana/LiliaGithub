import { describe, expect, it } from "vitest";
import { repoConflictRoute } from "../src/utils/repoRoutes";

describe("repoConflictRoute", () => {
  it("opens the changes tab with the conflict resolver intent", () => {
    expect(repoConflictRoute("repo/name with spaces")).toBe(
      "/repos/repo%2Fname%20with%20spaces/changes?resolveConflicts=1",
    );
  });
});
