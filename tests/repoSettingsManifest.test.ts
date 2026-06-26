import { describe, expect, it } from "vitest";
import {
  repoAutoSyncEnabled,
  repoCalculatesHomeTimeline,
  repoIncludedInHomeCodeStats,
  repoIncludedInHomeContributionStats,
  withRepoAutoSyncPreference,
  withRepoSettingPreference,
} from "../src/config/repoSettingsManifest";
import { workspaceSettings } from "./fixtures/workspace";

describe("repoSettingsManifest", () => {
  it("uses defaults when no repo preference is stored", () => {
    const settings = workspaceSettings();

    expect(repoAutoSyncEnabled(settings, "Repo1")).toBe(false);
    expect(repoIncludedInHomeCodeStats(settings, "Repo1")).toBe(true);
    expect(repoIncludedInHomeContributionStats(settings, "Repo1")).toBe(true);
    expect(repoCalculatesHomeTimeline(settings, "Repo1")).toBe(true);
    expect(repoAutoSyncEnabled(null, "Repo1")).toBe(false);
  });

  it("stores only non-default repo sync preferences", () => {
    const enabled = withRepoAutoSyncPreference({}, "Repo1", true);
    expect(enabled).toEqual({ Repo1: { autoSync: true } });

    const disabled = withRepoAutoSyncPreference(enabled, "Repo1", false);
    expect(disabled).toEqual({});
  });

  it("stores disabled homepage preferences and removes them when restored", () => {
    const disabled = withRepoSettingPreference({}, "Repo1", "includeInHomeCodeStats", false);
    expect(disabled).toEqual({ Repo1: { includeInHomeCodeStats: false } });

    const restored = withRepoSettingPreference(disabled, "Repo1", "includeInHomeCodeStats", true);
    expect(restored).toEqual({});
  });

  it("keeps mixed non-default preferences and removes the repo when all return to default", () => {
    const preferences = withRepoSettingPreference(
      withRepoSettingPreference({}, "Repo1", "autoSync", true),
      "Repo1",
      "calculateHomeTimeline",
      false,
    );
    expect(preferences).toEqual({ Repo1: { autoSync: true, calculateHomeTimeline: false } });

    const stillCustomized = withRepoSettingPreference(preferences, "Repo1", "autoSync", false);
    expect(stillCustomized).toEqual({ Repo1: { calculateHomeTimeline: false } });

    const restored = withRepoSettingPreference(stillCustomized, "Repo1", "calculateHomeTimeline", true);
    expect(restored).toEqual({});
  });
});
