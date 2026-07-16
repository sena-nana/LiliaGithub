import { describe, expect, it } from "vitest";
import { LiliaAppearanceSection } from "@lilia/ui/settings";
import {
  LILIA_UI_CONFIG,
  SETTINGS_SECTIONS,
} from "../src/config/appShell";

describe("appearance shell configuration", () => {
  it("uses the shared appearance section with platform backdrop defaults", () => {
    expect(SETTINGS_SECTIONS.appearance).toBe(LiliaAppearanceSection);
    expect(LILIA_UI_CONFIG.appearance).toEqual({
      backdropTarget: "sidebar",
      backdropOpacity: 0.64,
      platformDefaults: {
        macos: { backdropMode: "system" },
        windows: { backdropMode: "mica" },
        linux: { backdropMode: "solid" },
      },
    });
  });
});
