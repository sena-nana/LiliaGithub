import type {
  KeyboardShortcutActionId,
  KeyboardShortcutBinding,
} from "../../services/workspace";
import { loadWorkspaceService } from "./serviceLoader";
import { state } from "./state";

export async function setKeyboardShortcut(
  actionId: KeyboardShortcutActionId,
  shortcut: KeyboardShortcutBinding | null,
) {
  const service = await loadWorkspaceService();
  state.settings = await service.setKeyboardShortcut(actionId, shortcut);
  return state.settings;
}
