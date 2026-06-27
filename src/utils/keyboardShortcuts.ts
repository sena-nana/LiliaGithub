import type {
  KeyboardShortcutActionId,
  KeyboardShortcutBinding,
  KeyboardShortcutSettings,
} from "../services/workspace/types";

export const COMMAND_PALETTE_SHORTCUT_ACTION: KeyboardShortcutActionId = "commandPalette.open";

const INVALID_SHORTCUT_KEYS = new Set([
  "Alt",
  "AltGraph",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "CapsLock",
  "Control",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Meta",
  "PageDown",
  "PageUp",
  "Shift",
  "Tab",
]);

export function resolveKeyboardShortcut(
  shortcuts: KeyboardShortcutSettings | null | undefined,
  actionId: KeyboardShortcutActionId,
): KeyboardShortcutBinding | null {
  return shortcuts?.[actionId] ?? null;
}

export function matchesCommandPaletteShortcut(
  event: KeyboardEvent,
  shortcut: KeyboardShortcutBinding | null | undefined,
): boolean {
  if (!shortcut) {
    return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  }
  return matchesShortcutBinding(event, shortcut);
}

function matchesShortcutBinding(event: KeyboardEvent, shortcut: KeyboardShortcutBinding): boolean {
  return normalizeKey(event.key) === normalizeKey(shortcut.key) &&
    event.ctrlKey === shortcut.ctrlKey &&
    event.metaKey === shortcut.metaKey &&
    event.altKey === shortcut.altKey &&
    event.shiftKey === shortcut.shiftKey;
}

export function formatCommandPaletteShortcut(shortcut: KeyboardShortcutBinding | null | undefined): string {
  return shortcut ? formatShortcutBinding(shortcut) : "Ctrl/Cmd+K";
}

function formatShortcutBinding(shortcut: KeyboardShortcutBinding): string {
  return [
    shortcut.ctrlKey ? "Ctrl" : null,
    shortcut.metaKey ? "Cmd" : null,
    shortcut.altKey ? "Alt" : null,
    shortcut.shiftKey ? "Shift" : null,
    displayKey(shortcut.key),
  ].filter(Boolean).join("+");
}

export function captureShortcutBinding(event: KeyboardEvent): { shortcut: KeyboardShortcutBinding | null; error: string | null } {
  const key = normalizeRecordedKey(event.key);
  if (!key || INVALID_SHORTCUT_KEYS.has(key)) {
    return { shortcut: null, error: "请输入一个非修饰键组合。" };
  }
  const hasCommandModifier = event.ctrlKey || event.metaKey || event.altKey;
  const isFunctionKey = /^F(?:[1-9]|1[0-2])$/.test(key);
  if (!hasCommandModifier && !isFunctionKey) {
    return { shortcut: null, error: "非功能键快捷键需要包含 Ctrl、Cmd 或 Alt。" };
  }
  return {
    shortcut: {
      key,
      code: event.code || null,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    },
    error: null,
  };
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function normalizeRecordedKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function displayKey(key: string): string {
  return key === "Space" ? "Space" : key.toUpperCase();
}
