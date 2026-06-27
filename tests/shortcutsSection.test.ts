import { fireEvent, render, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it } from "vitest";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import { workspaceFallbackForTests } from "../src/services/workspace";
import ShortcutsSection from "../src/pages/settings/ShortcutsSection.vue";

describe("ShortcutsSection", () => {
  beforeEach(async () => {
    resetWorkspaceStateForTests();
    const workspaceFallback = await workspaceFallbackForTests();
    state.settings = await workspaceFallback.getWorkspaceSettings();
  });

  it("records and resets the command palette shortcut", async () => {
    const view = render(ShortcutsSection);
    const record = view.getByRole("button", { name: "录制" });

    expect(view.getByText("Ctrl/Cmd+K")).toBeInTheDocument();

    await fireEvent.click(record);
    await fireEvent.keyDown(record, { key: "p", code: "KeyP", ctrlKey: true, altKey: true });

    await waitFor(() => {
      expect(view.getByText("Ctrl+Alt+P")).toBeInTheDocument();
    });

    await fireEvent.click(view.getByRole("button", { name: "恢复默认" }));

    await waitFor(() => {
      expect(view.getByText("Ctrl/Cmd+K")).toBeInTheDocument();
    });
  });
});
