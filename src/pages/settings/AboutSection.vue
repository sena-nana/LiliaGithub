<template>
  <div class="card">
    <h2>关于</h2>
    <ul class="kv">
      <li><span>名称</span><span>LiliaGithub</span></li>
      <li><span>版本</span><span>1.0.0</span></li>
      <li><span>框架</span><span>Tauri 2 + Vue 3</span></li>
    </ul>
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
import { ref } from "vue";
import { check, type Update } from "@tauri-apps/plugin-updater";

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

@media (max-width: 720px) {
  .about-update {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
