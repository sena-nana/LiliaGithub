/// <reference types="vitest" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process 是 Node.js 全局对象
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process 是 Node.js 全局对象
const appDevPort = Number.parseInt(process.env.LILIA_GITHUB_DEV_PORT ?? "", 10);
// @ts-expect-error process 是 Node.js 全局对象
const strictPort = process.env.LILIA_GITHUB_DEV_STRICT_PORT === "1";
const port = Number.isInteger(appDevPort) ? appDevPort : 1420;

export default defineConfig(async () => ({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port,
    strictPort: strictPort || port === 1420,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setupTests.ts"],
  },
}));
