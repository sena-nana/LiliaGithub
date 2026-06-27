import {
  FolderGit2,
  Home,
  Info,
  Keyboard,
  Palette,
  Sparkles,
} from "@lucide/vue";
import type { Component } from "vue";
import type { RouteLocationRaw } from "vue-router";
import { createCachedAsyncComponent } from "../utils/asyncComponent";

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
  onSelect?: () => void;
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

export interface SidebarFooterStatus {
  to: string;
  label: string;
  title: string;
  tone: "ok" | "warn" | "error";
  icon: Component;
}

export const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    to: "/",
    label: "概览",
    icon: Home,
  },
];

export const SIDEBAR_GROUPS: SidebarGroup[] = [];

export const SIDEBAR_FOOTER_STATUS: SidebarFooterStatus = {
  to: "/settings",
  label: "GitHub",
  title: "GitHub 工作区状态。点击进入设置。",
  tone: "warn",
  icon: Sparkles,
};

export type SettingsTabKey = "appearance" | "shortcuts" | "repositories" | "about";

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
    key: "shortcuts",
    label: "快捷键",
    icon: Keyboard,
    to: { path: "/settings", query: { tab: "shortcuts" } },
  },
  {
    key: "repositories",
    label: "仓库",
    icon: FolderGit2,
    to: { path: "/settings", query: { tab: "repositories" } },
  },
  {
    key: "about",
    label: "关于",
    icon: Info,
    to: { path: "/settings", query: { tab: "about" } },
  },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = "appearance";

const appearanceSection = createCachedAsyncComponent(() => import("../pages/settings/AppearanceSection.vue"));
const shortcutsSection = createCachedAsyncComponent(() => import("../pages/settings/ShortcutsSection.vue"));
const repositoriesSection = createCachedAsyncComponent(() => import("../pages/settings/RepositoriesSection.vue"));
const aboutSection = createCachedAsyncComponent(() => import("../pages/settings/AboutSection.vue"));

export const SETTINGS_SECTIONS: Record<SettingsTabKey, Component> = {
  appearance: appearanceSection.component,
  shortcuts: shortcutsSection.component,
  repositories: repositoriesSection.component,
  about: aboutSection.component,
};

export function normalizeSettingsTab(value: unknown): SettingsTabKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.some((tab) => tab.key === candidate)
    ? (candidate as SettingsTabKey)
    : DEFAULT_SETTINGS_TAB;
}
