/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineLiliaViteConfig } from "@lilia/config";

const nanavueDomBridge = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "src/nana/nanavue-dom-bridge.ts",
);

export default defineLiliaViteConfig({
  server: {
    watch: {
      ignored: ["**/src-tauri/**", "**/agent-debug-runs/**"],
    },
  },
  vite: {
    resolve: {
      alias: {
        "@nanaui/nanavue-components": nanavueDomBridge,
      },
      dedupe: ["@lucide/vue"],
    },
  },
});
