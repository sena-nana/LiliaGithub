<script setup lang="ts">
/**
 * Nana critical Home — uses real @lilia/ui primitives (UiCard / UiButton),
 * not a handwritten AppShell replica. Setup → ready via mock transport.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { UiButton } from "@lilia/ui";
import { useWorkspace } from "../composables/useWorkspace";

const workspace = useWorkspace();
const router = useRouter();
const completing = ref(false);

const statusText = computed(() => {
  if (workspace.state.bootstrapStatus === "loading" || workspace.state.bootstrapStatus === "idle") {
    return "正在加载工作区…";
  }
  if (workspace.state.bootstrapStatus === "error") {
    return `错误：${workspace.state.error || "bootstrap failed"}`;
  }
  if (workspace.isReady.value) {
    return `Workspace ready · ${workspace.activeWorkspace.value?.name || "demo"}`;
  }
  return "Setup required · mock transport online";
});

onMounted(() => {
  void workspace.initialize();
});

async function completeSetup() {
  completing.value = true;
  try {
    await workspace.createWorkspace("demo-workspace", "/tmp/demo-workspace");
    if (typeof workspace.getGitHubBindingStatus === "function") {
      const status = await workspace.getGitHubBindingStatus();
      workspace.stateFeature?.applyBindingStatus?.(status);
    }
  } finally {
    completing.value = false;
  }
}
</script>

<template>
  <main
    class="home-page"
    data-page="home"
    data-agent-id="home.page"
    style="display: block; width: 100%; min-height: 320px; padding: 20px 24px; background: var(--bg); color: var(--text);"
  >
    <div
      class="page-header"
      style="display: block; width: 100%; margin-bottom: 16px; color: var(--text);"
    >
      <h1 style="margin: 0 0 6px; font-size: 22px; color: var(--text);">项目总览</h1>
      <p class="page-desc" style="margin: 0; color: var(--text-muted); font-size: 14px;">{{ statusText }}</p>
    </div>

    <div
      class="nana-home-card card"
      data-agent-id="home.card"
      style="display: block; width: 100%; min-height: 120px; padding: 16px; margin-top: 8px; background: var(--bg-elev); color: var(--text);"
    >
      <template v-if="workspace.isReady.value">
        <div class="lilia-status" data-agent-id="home.status" style="margin: 4px 0; color: var(--text); font-size: 14px;">Status: ready</div>
        <div class="lilia-status" style="margin: 4px 0; color: var(--text); font-size: 14px;">Probe: mock</div>
        <nana-gpu
          class="lilia-gpu-slot"
          data-slot="home-preview"
          style="display: block; width: 100%; height: 120px; background: #1e293b; margin-top: 12px;"
        />
      </template>
      <template v-else>
        <div class="lilia-status" style="margin: 4px 0; color: var(--text); font-size: 14px;">完成工作区与 GitHub 绑定以继续（Nana mock）。</div>
        <div style="display: flex; gap: 8px; margin-top: 12px">
          <UiButton
            variant="primary"
            data-agent-id="setup.complete"
            :disabled="completing"
            @click="completeSetup"
          >
            Complete setup
          </UiButton>
          <UiButton variant="ghost" @click="router.push('/settings?tab=appearance')">
            设置
          </UiButton>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.home-page {
  padding: 20px 24px;
  color: var(--text, #1a1d23);
}
.page-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.page-desc {
  margin: 0 0 16px;
  color: var(--text-muted, #5c6575);
}
.nana-home-card {
  padding: 16px;
}
.lilia-status {
  margin: 4px 0;
}
.lilia-gpu-slot {
  margin-top: 12px;
  border-radius: var(--radius-md, 10px);
}
</style>
