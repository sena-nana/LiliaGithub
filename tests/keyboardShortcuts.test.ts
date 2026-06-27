import { describe, expect, it } from "vitest";
import {
  captureShortcutBinding,
  formatCommandPaletteShortcut,
  matchesCommandPaletteShortcut,
} from "../src/utils/keyboardShortcuts";
import type { KeyboardShortcutBinding } from "../src/services/workspace";

function keydown(key: string, options: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", {
    key,
    code: options.code ?? `Key${key.toUpperCase()}`,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
  });
}

describe("keyboard shortcuts", () => {
  it("formats and matches the default command palette shortcut", () => {
    expect(formatCommandPaletteShortcut(null)).toBe("Ctrl/Cmd+K");
    expect(matchesCommandPaletteShortcut(keydown("k", { ctrlKey: true }), null)).toBe(true);
    expect(matchesCommandPaletteShortcut(keydown("k", { metaKey: true }), null)).toBe(true);
    expect(matchesCommandPaletteShortcut(keydown("k", { ctrlKey: true, shiftKey: true }), null)).toBe(false);
  });

  it("matches custom shortcuts exactly", () => {
    const shortcut: KeyboardShortcutBinding = {
      key: "P",
      code: "KeyP",
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: false,
    };

    expect(formatCommandPaletteShortcut(shortcut)).toBe("Ctrl+Alt+P");
    expect(matchesCommandPaletteShortcut(keydown("p", { ctrlKey: true, altKey: true }), shortcut)).toBe(true);
    expect(matchesCommandPaletteShortcut(keydown("k", { ctrlKey: true }), shortcut)).toBe(false);
  });

  it("rejects invalid recorded shortcuts", () => {
    expect(captureShortcutBinding(keydown("Control", { ctrlKey: true })).error).toBeTruthy();
    expect(captureShortcutBinding(keydown("K")).error).toBeTruthy();
    expect(captureShortcutBinding(keydown("F2")).shortcut?.key).toBe("F2");
    expect(captureShortcutBinding(keydown("K", { ctrlKey: true })).shortcut).toMatchObject({
      key: "K",
      ctrlKey: true,
    });
  });
});
