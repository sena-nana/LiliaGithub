import { describe, expect, it } from "vitest";
import {
  repoAutoSyncEnabled,
  withRepoAutoSyncPreference,
} from "../src/config/repoSettingsManifest";
import { workspaceSettings } from "./fixtures/workspace";

describe("repoSettingsManifest", () => {
  it("uses disabled auto sync as the default preference", () => {
    expect(repoAutoSyncEnabled(workspaceSettings(), "Repo1")).toBe(false);
    expect(repoAutoSyncEnabled(null, "Repo1")).toBe(false);
  });

  it("stores only non-default repo sync preferences", () => {
    const enabled = withRepoAutoSyncPreference({}, "Repo1", true);
    expect(enabled).toEqual({ Repo1: { autoSync: true } });

    const disabled = withRepoAutoSyncPreference(enabled, "Repo1", false);
    expect(disabled).toEqual({});
  });
});
