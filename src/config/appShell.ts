import {
  FilePlus2,
  Folder,
  Home,
  Info,
  MoreHorizontal,
  Palette,
  Puzzle,
  Search,
  Settings,
  Sparkles,
} from "lucide-vue-next";
import { defineAsyncComponent, type Component } from "vue";
import type { RouteLocationRaw } from "vue-router";

export const APP_TITLE = "LiliaGithub";

export const SIDEBAR_CONFIG = {
  widthStorageKey: "lilia-github.sidebarWidth",
  collapsedStorageKey: "lilia-github.sidebarCollapsed",
  minWidth: 180,
  maxWidth: 480,
  defaultWidth: 220,
} as const;

export interface SidebarActionItem {
  key: string;
  label: string;
  icon: Component;
  disabled?: boolean;
}

export interface SidebarNavItem {
  to?: string;
  label: string;
  icon: Component;
  tools?: SidebarActionItem[];
  disabled?: boolean;
}

export interface SidebarGroup {
  title: string;
  tools?: SidebarActionItem[];
  items?: SidebarNavItem[];
  emptyText?: string;
}

export interface SidebarFooterLink {
  to: string;
  label: string;
  title?: string;
  icon: Component;
}

export interface SidebarFooterStatus {
  to: string;
  label: string;
  title: string;
  tone: "ok" | "warn" | "error";
  icon: Component;
}

export const SIDEBAR_GLOBAL_ACTIONS: SidebarActionItem[] = [
  { key: "new", label: "新建", icon: FilePlus2, disabled: true },
  { key: "search", label: "搜索", icon: Search, disabled: true },
];

export const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    to: "/",
    label: "概览",
    icon: Home,
    tools: [{ key: "new", label: "新建", icon: FilePlus2, disabled: true }],
  },
];

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    title: "示例分组",
    tools: [{ key: "more", label: "更多", icon: MoreHorizontal, disabled: true }],
    items: [
      {
        label: "LiliaGithub Workspace",
        icon: Folder,
        disabled: true,
        tools: [{ key: "more", label: "更多", icon: MoreHorizontal, disabled: true }],
      },
    ],
    emptyText: "替换为你的业务导航。",
  },
];

export const SIDEBAR_FOOTER_LINKS: SidebarFooterLink[] = [
  { to: "/settings", label: "设置", icon: Settings },
  { to: "/plugins", label: "扩展", icon: Puzzle },
];

export const SIDEBAR_FOOTER_STATUS: SidebarFooterStatus = {
  to: "/settings",
  label: "Ready",
  title: "模板状态正常。点击进入设置。",
  tone: "ok",
  icon: Sparkles,
};

export type SettingsTabKey = "appearance" | "about";

export interface SettingsTab {
  key: SettingsTabKey;
  label: string;
  icon: Component;
  to: RouteLocationRaw;
}

export const SETTINGS_TABS: SettingsTab[] = [
  {
    key: "appearance",
    label: "外观",
    icon: Palette,
    to: { path: "/settings", query: { tab: "appearance" } },
  },
  {
    key: "about",
    label: "关于",
    icon: Info,
    to: { path: "/settings", query: { tab: "about" } },
  },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = "appearance";

export const SETTINGS_SECTIONS: Record<SettingsTabKey, Component> = {
  appearance: defineAsyncComponent(() => import("../pages/settings/AppearanceSection.vue")),
  about: defineAsyncComponent(() => import("../pages/settings/AboutSection.vue")),
};

export function normalizeSettingsTab(value: unknown): SettingsTabKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.some((tab) => tab.key === candidate)
    ? (candidate as SettingsTabKey)
    : DEFAULT_SETTINGS_TAB;
}
