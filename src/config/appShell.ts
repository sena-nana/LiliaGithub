import {
  FolderGit2,
  Info,
  Palette,
  Sparkles,
  UserRound,
} from "@lucide/vue";
import {
  type LiliaSidebarConfigInput,
  type LiliaUiConfig,
} from "../ui";
import {
  createLiliaSettingsModel,
  LiliaAppearanceSection,
  normalizeSettingsTab as normalizeLiliaSettingsTab,
} from "../ui";
import type { Component } from "vue";
import type { RouteLocationRaw } from "vue-router";
import appConfig from "../../app.config.json";
import { createCachedAsyncComponent } from "../utils/asyncComponent";

export const APP_TITLE = appConfig.productTitle;
type SidebarNavItems = NonNullable<LiliaSidebarConfigInput["nav"]>;

export const SIDEBAR_CONFIG = {
  widthStorageKey: "lilia-github.sidebarWidth",
  collapsedStorageKey: "lilia-github.sidebarCollapsed",
  minWidth: 180,
  maxWidth: 480,
  defaultWidth: 220,
} as const;

export const SIDEBAR_NAV: SidebarNavItems = [
  {
    key: "overview",
    to: "/",
    label: "项目总览",
    icon: FolderGit2,
  },
];

const footerStatus = {
  to: "/settings",
  label: "GitHub",
  title: "GitHub 工作区状态。点击进入设置。",
  tone: "warn",
  icon: Sparkles,
} satisfies NonNullable<LiliaSidebarConfigInput["footerStatuses"]>[number];

export type SettingsTabKey = "appearance" | "account" | "repositories" | "about";

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
    key: "account",
    label: "账户",
    icon: UserRound,
    to: { path: "/settings", query: { tab: "account" } },
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

const repositoriesSection = createCachedAsyncComponent(() => import("../pages/settings/RepositoriesSection.vue"));
const accountSection = createCachedAsyncComponent(() => import("../pages/settings/AccountSection.vue"));
const aboutSection = createCachedAsyncComponent(() => import("../pages/settings/AboutSection.vue"));
export const LILIA_AGENT_DEBUG_ENABLED = import.meta.env.VITE_LILIA_AGENT_DEBUG === "1" ||
  import.meta.env.VITE_LILIA_GITHUB_AGENT_DEBUG === "1" ||
  import.meta.env.MODE === "agent-debug";

export const SETTINGS_SECTIONS: Record<SettingsTabKey, Component> = {
  appearance: LiliaAppearanceSection,
  account: accountSection.component,
  repositories: repositoriesSection.component,
  about: aboutSection.component,
};

export const LILIA_SETTINGS_MODEL = createLiliaSettingsModel({
  path: "/settings",
  defaultTab: DEFAULT_SETTINGS_TAB,
  description: "管理外观、账户、仓库和应用信息。",
  tabs: SETTINGS_TABS,
  sections: SETTINGS_SECTIONS,
});

export const LILIA_UI_CONFIG = {
  appName: appConfig.appName,
  productTitle: APP_TITLE,
  version: appConfig.version,
  identifier: appConfig.identifier,
  storageKeyPrefix: appConfig.storageKeyPrefix,
  appearance: {
    backdropTarget: "sidebar",
    backdropOpacity: 0.64,
    platformDefaults: {
      macos: { backdropMode: "system" },
      windows: { backdropMode: "mica" },
      linux: { backdropMode: "solid" },
    },
  },
  sidebar: {
    ...SIDEBAR_CONFIG,
    nav: SIDEBAR_NAV,
    footerStatuses: [footerStatus],
  },
} satisfies LiliaUiConfig;

export function normalizeSettingsTab(value: unknown): SettingsTabKey {
  return normalizeLiliaSettingsTab(LILIA_SETTINGS_MODEL, value) as SettingsTabKey;
}
