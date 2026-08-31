declare module "@nanaui/nanavue-components" {
  import type { DefineComponent } from "vue";

  type NanaVueComponent = DefineComponent<Record<string, unknown>, unknown, unknown>;

  export const NanaButton: NanaVueComponent;
  export const NanaChip: NanaVueComponent;
  export const NanaThemeToggle: NanaVueComponent;
  export const NanaAppearancePanel: NanaVueComponent;
  export const NanaWorkspaceShell: NanaVueComponent;
  export const NanaSidebarNav: NanaVueComponent;
  export const NanaSidebarFrame: NanaVueComponent;
  export const NanaSidebarRow: NanaVueComponent;
  export const NanaSegmented: NanaVueComponent;
  export const NanaTabs: NanaVueComponent;
  export const NanaSwitch: NanaVueComponent;
  export const NanaSettingsRow: NanaVueComponent;
  export const NanaSettingsCard: NanaVueComponent;
  export const NanaRangeField: NanaVueComponent;
  export const NanaInput: NanaVueComponent;
  export const NanaSettingsPage: NanaVueComponent;
  export const NanaDialog: NanaVueComponent;
  export const NanaDrawer: NanaVueComponent;
  export const NanaDropdown: NanaVueComponent;
  export const NanaContextMenuHost: NanaVueComponent;

  export function createNanaContextMenuHost(options: {
    useState: () => unknown;
    close?: () => void;
  }): NanaVueComponent;
}

declare module "@nanaui/nanavue-runtime" {
  import type { App, Component } from "vue";

  export function createApp(root: Component, rootProps?: unknown): App;
  export function wrapNode(...args: unknown[]): unknown;
  export function installEventBridge(...args: unknown[]): unknown;
  export function hostCall(name: string, args?: unknown[]): unknown;
  export function nodeId(node?: unknown): unknown;
}

interface NanaLayoutSnapshot {
  boxes?: unknown[];
  texts?: unknown;
  gpuSlots?: unknown;
  stylesheets?: number;
}

interface NanaOverlayEvidenceHost {
  openAll?: () => unknown;
  closeAll?: () => unknown;
  snapshot?: () => unknown;
}

declare var __NANA_LILIA_TOKENS_CSS: string | undefined;
declare var __NANA_LILIA_PAGE_CSS: string | undefined;
declare var __nanaLiliaError: string | null | undefined;
declare var __nanaLiliaLast: unknown;
declare var __nanaLiliaReady: boolean | undefined;
declare var __nanaLiliaPending: Promise<unknown> | undefined;
declare var __nanaLilia: Record<string, unknown> | undefined;
declare var __nanaOverlayEvidence: NanaOverlayEvidenceHost | undefined;
declare var __nanaLiliaRunHome: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaRunSettings: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaRunSettingsAccount: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaRunSettingsWorkspace: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaRunSettingsAbout: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaRunProfile: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaRunRepo: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaIsReady: (() => boolean) | undefined;
declare var __nanaLiliaGetLast: (() => unknown) | undefined;
declare var __nanaLiliaCompleteSetup: ((opts?: unknown) => unknown) | undefined;
declare var __nanaLiliaForceTheme: ((theme?: unknown) => unknown) | undefined;
declare var __nanaLiliaOpenOverlays: (() => unknown) | undefined;
declare var __nanaLiliaCloseOverlays: (() => unknown) | undefined;
declare var __nanaLiliaGetOverlayState: (() => unknown) | undefined;
