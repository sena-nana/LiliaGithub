import { installLiliaContextMenu } from "../../src/ui";
import type { Plugin } from "vue";

export const liliaContextMenuPlugin: Plugin = {
  install: installLiliaContextMenu,
};
