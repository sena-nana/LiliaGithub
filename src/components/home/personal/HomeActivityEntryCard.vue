<script setup lang="ts">
import { Activity, UserRound } from "@lucide/vue";
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useWorkspace } from "../../../composables/useWorkspace";
import HomePanelShell from "./HomePanelShell.vue";

const workspace = useWorkspace();
const error = ref<string | null>(null);
const login = computed(() => workspace.githubBinding.value?.login ?? null);

async function openActivity() {
  if (!login.value) return;
  error.value = null;
  try {
    await workspace.openUrl(`https://github.com/${encodeURIComponent(login.value)}?tab=overview`);
  } catch {
    error.value = "无法打开 GitHub 活动，请重试。";
  }
}
</script>

<template>
  <HomePanelShell title="活动" agent-id="personal-home.activity" :error="error">
    <template v-if="login">
      <p class="activity-copy">查看 {{ login }} 的贡献与公开活动。</p>
      <div class="activity-actions">
        <button type="button" data-agent-id="personal-home.activity.open" @click="openActivity">
          <Activity :size="14" aria-hidden="true" />
          GitHub 活动
        </button>
        <RouterLink to="/profile" data-agent-id="personal-home.activity.profile">
          <UserRound :size="14" aria-hidden="true" />
          个人资料
        </RouterLink>
      </div>
    </template>
    <p v-else class="activity-copy">绑定 GitHub 后可查看个人活动。</p>
  </HomePanelShell>
</template>

<style scoped>
.activity-copy { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.activity-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.activity-actions button, .activity-actions a { display: inline-flex; min-height: 28px; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg); color: var(--text); font-size: 12px; text-decoration: none; }
.activity-actions button:hover, .activity-actions a:hover { background: var(--bg-hover); }
</style>
