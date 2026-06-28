<template>
  <div class="card">
    <h2>关于</h2>
    <ul class="kv">
      <li><span>名称</span><span>{{ appName }}</span></li>
      <li><span>版本</span><span>{{ appVersion }}</span></li>
      <li><span>框架</span><span>Tauri 2 + Vue 3</span></li>
    </ul>
    <section
      class="about-license"
      aria-label="开源许可证"
      data-agent-id="settings.about.licenses"
    >
      <h3>关于</h3>
      <p v-if="!hasLicenseManifest" class="about-license-fallback">
        {{ fallbackText }}
      </p>
      <template v-else>
        <ul class="kv">
          <li><span>应用名称</span><span>{{ appName }}</span></li>
          <li><span>版本</span><span>{{ appVersion }}</span></li>
          <li><span>许可证</span><span>{{ appLicense }}</span></li>
        </ul>
      </template>
    </section>
    <section class="about-license-third-party" aria-label="第三方许可证协议">
      <h3>第三方许可证协议</h3>
      <template v-if="hasLicenseManifest">
        <details class="about-license-details">
          <summary>依赖明细（{{ dependencyCount }}）</summary>
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
    <section class="about-update" aria-label="更新器" data-agent-id="settings.about.updater">
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
const fallbackText = "未生成许可清单，请重试 yarn about:licenses";

const hasLicenseManifest = computed(() => {
  return (
    Boolean(manifest?.app?.name) &&
    Array.isArray(manifest?.npmDependencies) &&
    Array.isArray(manifest?.rustDependencies)
  );
});

const appName = computed(() => manifest?.app?.name || "LiliaGithub");
const appVersion = computed(() => manifest?.app?.version ?? "1.0.0");
const appLicense = computed(() => manifest?.app?.license ?? "未声明");
const npmDependencies = computed(() => manifest?.npmDependencies ?? []);
const rustDependencies = computed(() => manifest?.rustDependencies ?? []);
const dependencyCount = computed(() => npmDependencies.value.length + rustDependencies.value.length);

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
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.about-update p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.about-license {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.about-license h3 {
  margin: 0 0 10px;
}

.about-license .kv span {
  line-height: 1.45;
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

.about-license-details {
  margin-top: 12px;
}

.about-license-details summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 720px) {
  .about-update {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
