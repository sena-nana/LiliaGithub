import { reactive, type Component } from "vue";

export interface ContextMenuItem {
  id?: string;
  label: string;
  icon?: Component;
  disabled?: boolean;
  danger?: boolean;
  confirmLabel?: string;
  children?: ContextMenuItem[];
  onSelect?: () => void | Promise<void>;
}

export type ContextMenuProvider = (
  event: MouseEvent,
) => ContextMenuItem[] | null | undefined;

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  items: ContextMenuItem[];
  pendingConfirmId: string | null;
  openSeq: number;
}

const state = reactive<MenuState>({
  open: false,
  x: 0,
  y: 0,
  anchorX: 0,
  anchorY: 0,
  items: [],
  pendingConfirmId: null,
  openSeq: 0,
});

const providers = new WeakMap<Element, ContextMenuProvider>();
let installed = false;

export function registerContextMenu(
  element: Element,
  provider: ContextMenuProvider,
) {
  providers.set(element, provider);
  return () => providers.delete(element);
}

function itemKey(item: ContextMenuItem): string {
  return item.id ?? item.label;
}

function collectItemsFor(event: MouseEvent): ContextMenuItem[] {
  let node = event.target as Element | null;
  while (node) {
    const provider = providers.get(node);
    const items = provider?.(event);
    if (items?.length) return items;
    node = node.parentElement;
  }
  return [];
}

function openMenu(x: number, y: number, items: ContextMenuItem[]) {
  state.items = items;
  state.x = x;
  state.y = y;
  state.anchorX = x;
  state.anchorY = y;
  state.open = items.length > 0;
  state.pendingConfirmId = null;
  state.openSeq += 1;
}

export function openContextMenuAt(
  x: number,
  y: number,
  items: ContextMenuItem[],
) {
  if (!items.length) return;
  openMenu(x, y, items);
}

export function closeContextMenu() {
  if (!state.open) return;
  state.open = false;
}

function onContextMenu(event: MouseEvent) {
  event.preventDefault();
  const items = collectItemsFor(event);
  if (items.length) openMenu(event.clientX, event.clientY, items);
  else closeContextMenu();
}

function onPointerDown(event: PointerEvent) {
  if (!state.open) return;
  const target = event.target as Element | null;
  if (target?.closest?.(".ctx-menu")) return;
  closeContextMenu();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && state.open) {
    closeContextMenu();
    event.stopPropagation();
  }
}

function onScroll() {
  if (state.open) closeContextMenu();
}

export function finalizeClosedContextMenu() {
  if (state.open) return;
  state.items = [];
  state.pendingConfirmId = null;
}

export function isContextMenuItemPending(item: ContextMenuItem): boolean {
  if (!item.confirmLabel) return false;
  return state.pendingConfirmId === itemKey(item);
}

export async function selectContextMenuItem(item: ContextMenuItem) {
  if (item.disabled) return;
  if (item.children?.length) {
    state.items = item.children;
    state.pendingConfirmId = null;
    state.openSeq += 1;
    return;
  }
  const key = itemKey(item);
  if (item.confirmLabel && state.pendingConfirmId !== key) {
    state.pendingConfirmId = key;
    return;
  }
  closeContextMenu();
  await item.onSelect?.();
}

export function installContextMenu() {
  if (installed || typeof window === "undefined") return uninstallContextMenu;
  installed = true;

  window.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("blur", closeContextMenu);
  return uninstallContextMenu;
}

export function uninstallContextMenu() {
  if (!installed || typeof window === "undefined") return;
  installed = false;
  window.removeEventListener("contextmenu", onContextMenu);
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", closeContextMenu);
  window.removeEventListener("blur", closeContextMenu);
  closeContextMenu();
  finalizeClosedContextMenu();
}

export function useContextMenu() {
  return {
    state,
    close: closeContextMenu,
    select: selectContextMenuItem,
  };
}
