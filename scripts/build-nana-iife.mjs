#!/usr/bin/env node
/**
 * Build LiliaGithub Nana IIFE for nana-tauri-demo.
 *
 * Usage (from LiliaGithub root):
 *   node scripts/build-nana-iife.mjs
 *
 * Output: dist/lilia-github.iife.js + dist/manifest.json
 */
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const nanaUi = path.resolve(root, "../NanaUI");
const outDir = path.join(root, "dist");
const entry = path.join(root, "src/nana/main.ts");

const tokensCss = fs.readFileSync(path.join(root, "src/nana/css/tokens.css"), "utf8");
const pageCss = fs.readFileSync(path.join(root, "src/nana/css/page.css"), "utf8");

function bannerCssAssign(name, css) {
  return `globalThis.${name} = ${JSON.stringify(css)};\n`;
}

const banner =
  bannerCssAssign("__NANA_LILIA_TOKENS_CSS", tokensCss) +
  bannerCssAssign("__NANA_LILIA_PAGE_CSS", pageCss);

await fs.promises.mkdir(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  logLevel: "info",
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === "nana-gpu",
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@nanaui/nanavue-runtime": path.join(nanaUi, "packages/nanavue-runtime/src/createNanaRenderer.js"),
      "@nanaui/nanavue-components": path.join(nanaUi, "packages/nanavue-components/src/index.js"),
      // Dropdown / SearchDropdown → Nana Select (no CSS fixed Teleport menus).
      "@lilia/ui/search": path.join(nanaUi, "packages/nanavue-components/src/nana-search.js"),
      vue: path.join(root, "node_modules/vue/dist/vue.runtime.esm-bundler.js"),
      "@vue/runtime-core": path.join(root, "node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js"),
      "@vue/runtime-dom": path.join(root, "node_modules/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js"),
      "@vue/reactivity": path.join(root, "node_modules/@vue/reactivity/dist/reactivity.esm-bundler.js"),
      "@vue/shared": path.join(root, "node_modules/@vue/shared/dist/shared.esm-bundler.js"),
    },
    dedupe: ["vue", "@vue/runtime-core", "@lucide/vue"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    outDir,
    emptyOutDir: false,
    lib: {
      entry,
      name: "LiliaGithubNana",
      formats: ["iife"],
      fileName: () => "lilia-github.iife.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        banner,
        assetFileNames: "lilia-github.[ext]",
      },
    },
    cssCodeSplit: false,
    sourcemap: false,
    minify: true,
    target: "es2020",
  },
});

const iifePath = path.join(outDir, "lilia-github.iife.js");
const bytes = fs.statSync(iifePath).size;
const manifest = {
  builtAt: new Date().toISOString(),
  liliaGithub: root,
  entry: "src/nana/main.ts",
  bytes,
  strategy: "vite-iife-inlineDynamicImports-nana-real-home",
  cssColorStrategy: "oklch-colormix-preresolve-hex",
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`built ${iifePath} (${bytes} bytes)`);
