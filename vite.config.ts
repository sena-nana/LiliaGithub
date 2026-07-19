/// <reference types="vitest" />
import { defineLiliaViteConfig } from "@lilia/config";

export default defineLiliaViteConfig({
  server: {
    watch: {
      ignored: ["**/src-tauri/**", "**/agent-debug-runs/**"],
    },
  },
  vite: {
    resolve: {
      dedupe: ["@lucide/vue"],
    },
  },
});
