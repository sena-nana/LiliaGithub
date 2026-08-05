import { installLiliaContextMenu } from "@lilia/ui/runtime";
import type { Plugin } from "vue";

export const liliaContextMenuPlugin: Plugin = {
  install: installLiliaContextMenu,
};
