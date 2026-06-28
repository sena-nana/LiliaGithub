<template>
  <div class="about-page">
    <section class="card about-main">
    <h2>关于</h2>
    <ul class="kv">
      <li><span>名称</span><span>{{ appName }}</span></li>
      <li><span>版本</span><span>{{ appVersion }}</span></li>
    </ul>
    </section>
    <section class="card about-license-third-party" aria-label="第三方许可证协议">
      <template v-if="hasLicenseManifest">
        <details class="about-license-details">
          <summary>第三方许可证协议</summary>
          <div v-if="npmDependencies.length">
            <div class="about-license-summary-title">npm</div>
            <ul class="kv">
              <li v-for="dependency in npmDependencies" :key="`npm-dep-${dependency.name}`">
                <span>{{ dependency.name }}</span>
                <span>{{ dependency.version }} · {{ dependency.license }}</span>
              </li>
            </ul>
          </div>
          <div v-if="rustDependencies.length">
            <div class="about-license-summary-title">Rust</div>
            <ul class="kv">
              <li v-for="dependency in rustDependencies" :key="`rust-dep-${dependency.name}`">
                <span>{{ dependency.name }}</span>
                <span>{{ dependency.version }} · {{ dependency.license }}</span>
              </li>
            </ul>
          </div>
          <div v-if="!npmDependencies.length && !rustDependencies.length" class="about-license-empty">
            未发现可汇总的依赖记录。
          </div>
        </details>
      </template>
      <p v-else class="about-license-fallback">未生成许可清单，请重试 yarn about:licenses</p>
    </section>
    <section class="card about-update" aria-label="更新器" data-agent-id="settings.about.updater">
      <div>
        <strong>更新</strong>
        <p>{{ updateMessage }}</p>
      </div>
      <button
        type="button"
        class="ghost"
        data-agent-id="settings.about.updater.check"
        :disabled="checking || installing"
        @click="checkForUpdate"
      >
        {{ checking ? "检查中" : "检查更新" }}
      </button>
      <button
        v-if="pendingUpdate"
        type="button"
        class="primary"
        data-agent-id="settings.about.updater.install"
        :disabled="installing"
        @click="installUpdate"
      >
        {{ installing ? "安装中" : "下载并安装" }}
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { check, type Update } from "@tauri-apps/plugin-updater";
import openSourceLicenseManifest from "../../generated/openSourceLicenseManifest.json";

interface OpenSourceLicenseManifestDependency {
  name: string;
  version: string;
  license: string;
}

interface OpenSourceLicenseManifest {
  app?: {
    name?: string;
    version?: string;
    license?: string;
  };
  npmDependencies?: OpenSourceLicenseManifestDependency[];
  rustDependencies?: OpenSourceLicenseManifestDependency[];
}

const manifest = openSourceLicenseManifest as OpenSourceLicenseManifest | null;

const hasLicenseManifest = computed(() => {
  return (
    Boolean(manifest?.app?.name) &&
    Array.isArray(manifest?.npmDependencies) &&
    Array.isArray(manifest?.rustDependencies)
  );
});

const appName = computed(() => manifest?.app?.name || "LiliaGithub");
const appVersion = computed(() => manifest?.app?.version ?? "1.0.0");
const npmDependencies = computed(() => manifest?.npmDependencies ?? []);
const rustDependencies = computed(() => manifest?.rustDependencies ?? []);
const checking = ref(false);
const installing = ref(false);
const pendingUpdate = ref<Update | null>(null);
const updateMessage = ref("正式发布包会通过 Tauri updater 检查 GitHub Releases。");

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function checkForUpdate() {
  checking.value = true;
  pendingUpdate.value = null;
  updateMessage.value = "正在检查更新。";
  try {
    const update = await check();
    pendingUpdate.value = update;
    updateMessage.value = update
      ? `发现 ${update.version}，当前版本 ${update.currentVersion}。`
      : "当前已是最新版本。";
  } catch (error) {
    updateMessage.value = `检查更新失败：${errorMessage(error)}`;
  } finally {
    checking.value = false;
  }
}

async function installUpdate() {
  if (!pendingUpdate.value) return;
  installing.value = true;
  updateMessage.value = "正在下载更新。";
  try {
    await pendingUpdate.value.downloadAndInstall((event) => {
      if (event.event === "Started") {
        updateMessage.value = "正在下载更新包。";
      } else if (event.event === "Finished") {
        updateMessage.value = "更新包下载完成，正在安装。";
      }
    });
    updateMessage.value = "更新已安装，重启应用后生效。";
    pendingUpdate.value = null;
  } catch (error) {
    updateMessage.value = `安装更新失败：${errorMessage(error)}`;
  } finally {
    installing.value = false;
  }
}
</script>

<style scoped>
.about-update {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
}

.about-page {
  display: grid;
  gap: 12px;
}

.about-update p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.about-license-fallback {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
}

.about-license-summary-title {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 4px;
}

.about-license-empty {
  font-size: 13px;
  color: var(--muted);
}

.about-license-details summary {
  display: inline-flex;
  align-items: center;
  width: auto;
  list-style: none;
  margin: 0 0 10px;
  cursor: pointer;
  padding: 0;
  line-height: normal;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.about-license-details > summary::after {
  content: "";
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid var(--text-muted);
  border-right: 0;
  margin-left: 6px;
  display: inline-block;
  transform-origin: center center;
  transform: rotate(0deg);
  transition: transform 0.15s ease;
}

.about-license-details[open] > summary::after {
  transform: rotate(90deg);
}

.about-license-details > summary::-webkit-details-marker {
  display: none;
}

.about-license-details summary ~ div,
.about-license-details summary ~ p,
.about-license-details summary ~ ul {
  margin-top: 8px;
}

.about-license-details summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 58%, transparent);
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .about-update {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
