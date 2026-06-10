import { computed, type Ref } from "vue";
import { SIDEBAR_CONFIG } from "../config/appShell";
import { usePersistentBoolean } from "./usePersistentState";
import { useResizablePane } from "./useResizablePane";

export function useShellSidebar(disabled: Ref<boolean>) {
  const collapsed = usePersistentBoolean(
    SIDEBAR_CONFIG.collapsedStorageKey,
    false,
  );
  const effectiveCollapsed = computed(() => !disabled.value && collapsed.value);

  const pane = useResizablePane({
    storageKey: SIDEBAR_CONFIG.widthStorageKey,
    minWidth: SIDEBAR_CONFIG.minWidth,
    maxWidth: SIDEBAR_CONFIG.maxWidth,
    defaultWidth: SIDEBAR_CONFIG.defaultWidth,
    edge: "right",
    disabled: effectiveCollapsed,
  });

  const sidebarWidthStyle = computed(() =>
    effectiveCollapsed.value ? "0px" : `${pane.width.value}px`,
  );

  function toggleCollapsed() {
    if (disabled.value) return;
    collapsed.value = !collapsed.value;
  }

  return {
    collapsed,
    effectiveCollapsed,
    isResizing: pane.isResizing,
    width: pane.width,
    widthStyle: sidebarWidthStyle,
    minWidth: SIDEBAR_CONFIG.minWidth,
    maxWidth: SIDEBAR_CONFIG.maxWidth,
    toggleCollapsed,
    startResize: pane.startResize,
    resetWidth: pane.resetWidth,
  };
}
