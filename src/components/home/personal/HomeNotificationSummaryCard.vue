<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../../composables/useLatestAsyncLoader";
import { listPersonalNotifications, type PersonalHomeNotification } from "../../../services/personalHome";
import { notificationTypeCounts } from "../../../utils/personalHome";
import HomePanelShell from "./HomePanelShell.vue";

const componentEpoch = useComponentEpoch();
const loader = createLatestAsyncLoader({ componentEpoch });
const notifications = ref<PersonalHomeNotification[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const unread = computed(() => notifications.value.filter((item) => item.unread));
const groups = computed(() => notificationTypeCounts(notifications.value));

async function load(forceRefresh = false) {
  await loader.run(forceRefresh ? "notifications:refresh" : "notifications", async (runId) => {
    loading.value = true;
    error.value = null;
    try {
      const result = await listPersonalNotifications(50, { forceRefresh });
      if (loader.isCurrent(runId)) notifications.value = result;
    } catch {
      if (loader.isCurrent(runId)) error.value = "暂时无法读取 GitHub 通知，请重试。";
    } finally {
      if (loader.isCurrent(runId)) loading.value = false;
    }
  });
}

onMounted(() => void load());
onUnmounted(loader.invalidate);
</script>

<template>
  <HomePanelShell
    title="通知摘要"
    agent-id="personal-home.notifications"
    :loading="loading"
    :error="error"
    refreshable
    @refresh="load(true)"
  >
    <p v-if="loading && !notifications.length" class="home-panel-empty">正在加载...</p>
    <template v-else>
      <div class="notification-summary">
        <strong>{{ unread.length }}</strong>
        <span>条未读通知</span>
      </div>
      <ul v-if="groups.length" class="notification-groups" aria-label="未读通知分类">
        <li v-for="group in groups" :key="group.label"><span>{{ group.label }}</span><strong>{{ group.count }}</strong></li>
      </ul>
      <p v-else class="home-panel-empty">当前没有未读通知</p>
      <RouterLink to="/notifications" class="home-panel-link" data-agent-id="personal-home.notifications.open">
        查看通知
      </RouterLink>
    </template>
  </HomePanelShell>
</template>

<style scoped>
.home-panel-empty { margin: 0; color: var(--text-muted); font-size: 12px; }
.notification-summary { display: flex; align-items: baseline; gap: 5px; }
.notification-summary strong { color: var(--text); font-size: 24px; font-weight: 650; }
.notification-summary span { color: var(--text-muted); font-size: 12px; }
.notification-groups { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 0; padding: 0; list-style: none; }
.notification-groups li { display: inline-flex; gap: 5px; padding: 3px 6px; border-radius: 5px; background: var(--bg-subtle); color: var(--text-muted); font-size: 11px; }
.notification-groups strong { color: var(--text); }
.home-panel-link { display: inline-flex; width: fit-content; margin-top: 10px; padding: 0; border: 0; background: transparent; color: var(--accent); font-size: 12px; text-decoration: none; }
.home-panel-link:hover { color: var(--accent-strong); text-decoration: underline; }
</style>
