import { describe, expect, it } from "vitest";
import {
  normalizeRepoProjectCreateFlow,
  normalizeRepoProjectTab,
  repoProjectCreateRoute,
  repoProjectRoute,
} from "../src/utils/repoRoutes";

describe("discussion repository routes", () => {
  it("builds and normalizes list, detail and create routes", () => {
    expect(repoProjectRoute("acme/repo", "discussions")).toBe(
      "/repos/acme%2Frepo?projectTab=discussions",
    );
    expect(repoProjectRoute("acme/repo", "discussions", 14)).toBe(
      "/repos/acme%2Frepo?projectTab=discussions&discussion=14",
    );
    expect(repoProjectCreateRoute("acme/repo", "discussion")).toBe(
      "/repos/acme%2Frepo?projectTab=discussions&create=discussion",
    );
    expect(normalizeRepoProjectTab("discussions")).toBe("discussions");
    expect(normalizeRepoProjectCreateFlow("discussion")).toBe("discussion");
  });
});
