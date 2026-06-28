import { fireEvent, render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import RepoToolbarSettingsMenu from "../src/components/repo/RepoToolbarSettingsMenu.vue";

function renderMenu(autoSync = false) {
  return render(RepoToolbarSettingsMenu, {
    props: {
      values: {
        autoSync,
        includeInHomeCodeStats: true,
        includeInHomeContributionStats: true,
        calculateHomeTimeline: true,
      },
    },
  });
}

describe("RepoToolbarSettingsMenu", () => {
  it("opens the settings menu and emits auto sync changes", async () => {
    const view = renderMenu(false);

    await fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const autoSync = screen.getByRole("checkbox", { name: "自动同步" });
    expect(autoSync).not.toBeChecked();

    await fireEvent.click(autoSync);

    expect(view.emitted("update:setting")?.[0]).toEqual(["autoSync", true]);
  });

  it("reflects enabled auto sync state", async () => {
    renderMenu(true);

    await fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByRole("checkbox", { name: "自动同步" })).toBeChecked();
  });
});
