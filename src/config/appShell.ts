import {
  FolderGit2,
  Home,
  Info,
  Palette,
  Sparkles,
} from "@lucide/vue";
import type { LiliaAppConfig, LiliaSidebarConfigInput } from "@lilia/ui";
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

export type SidebarActionItem = NonNullable<
  NonNullable<LiliaSidebarConfigInput["nav"]>[number]["tools"]
>[number];
export type SidebarNavItem = NonNullable<LiliaSidebarConfigInput["nav"]>[number];

export const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    key: "overview",
    to: "/",
    label: "概览",
    icon: Home,
  },
];

const footerStatus = {
  to: "/settings",
  label: "GitHub",
  title: "GitHub 工作区状态。点击进入设置。",
  tone: "warn",
  icon: Sparkles,
} satisfies NonNullable<LiliaSidebarConfigInput["footerStatus"]>;

export type SettingsTabKey = "appearance" | "repositories" | "about";

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
const repositoriesSection = createCachedAsyncComponent(() => import("../pages/settings/RepositoriesSection.vue"));
const aboutSection = createCachedAsyncComponent(() => import("../pages/settings/AboutSection.vue"));

export const SETTINGS_SECTIONS: Record<SettingsTabKey, Component> = {
  appearance: appearanceSection.component,
  repositories: repositoriesSection.component,
  about: aboutSection.component,
};

export const LILIA_UI_CONFIG = {
  appName: "lilia-github",
  productTitle: APP_TITLE,
  version: "1.0.0-beta.1",
  identifier: "com.lilia.github",
  storageKeyPrefix: "lilia-github",
  shell: {
    homeTitle: "概览",
    homeDescription: "查看本地工作区和 GitHub 协作状态。",
    workspaceSectionTitle: "工作区",
    workspaceName: "GitHub Workspace",
    workspaceEmptyText: "选择工作区后显示 Git 仓库。",
    statusLabel: footerStatus.label,
    statusTitle: footerStatus.title,
    settingsDescription: "管理外观、仓库、GitHub 授权和应用信息。",
  },
  sidebar: {
    ...SIDEBAR_CONFIG,
    nav: SIDEBAR_NAV,
    footerStatus,
  },
} satisfies LiliaAppConfig;

export function normalizeSettingsTab(value: unknown): SettingsTabKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.some((tab) => tab.key === candidate)
    ? (candidate as SettingsTabKey)
    : DEFAULT_SETTINGS_TAB;
}
