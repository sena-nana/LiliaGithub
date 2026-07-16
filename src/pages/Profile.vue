<script setup lang="ts">
import { RouterLink } from "vue-router";
import GitHubAccountProfileEditor from "../components/account/GitHubAccountProfileEditor.vue";
import { useWorkspace } from "../composables/useWorkspace";

const workspace = useWorkspace();
</script>

<template>
  <section class="profile-page" data-agent-id="profile.page">
    <div class="profile-page__inner">
      <header class="profile-page__header">
        <div>
          <h1>用户资料</h1>
          <p v-if="workspace.githubBinding.value">查看和管理 {{ workspace.githubBinding.value.login }} 的 GitHub 公开资料。</p>
          <p v-else>绑定 GitHub 后可查看和更新公开资料。</p>
        </div>
      </header>

      <GitHubAccountProfileEditor v-if="workspace.githubBinding.value" />
      <div v-else class="card profile-page__unavailable" role="status">
        <div>
          <h2>GitHub 尚未绑定</h2>
          <p>完成账户绑定后即可查看和管理公开资料。</p>
        </div>
        <RouterLink
          :to="{ path: '/settings', query: { tab: 'account' } }"
          class="primary profile-page__settings"
          data-agent-id="profile.open-account-settings"
        >
          前往账户设置
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.profile-page {
  min-width: 0;
}

.profile-page__inner {
  width: min(100%, 1040px);
  margin: 0 auto;
}

.profile-page__header {
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.profile-page__header h1,
.profile-page__header p {
  margin: 0;
}

.profile-page__header h1 {
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
}

.profile-page__header p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.profile-page__unavailable {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 104px;
}

.profile-page__unavailable h2,
.profile-page__unavailable p {
  margin: 0;
}

.profile-page__unavailable h2 {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

.profile-page__unavailable p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.profile-page__settings {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  text-decoration: none;
}

@media (max-width: 540px) {
  .profile-page__unavailable {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
