<script setup lang="ts">
import { RouterLink } from "vue-router";
import GitHubAccountProfileEditor from "../components/account/GitHubAccountProfileEditor.vue";
import { useWorkspace } from "../composables/useWorkspace";

const workspace = useWorkspace();
</script>

<template>
  <section class="profile-page" data-agent-id="profile.page">
    <div class="page-header">
      <div>
        <h1>用户资料</h1>
        <p v-if="workspace.githubBinding.value">管理 {{ workspace.githubBinding.value.login }} 的 GitHub 公开资料。</p>
        <p v-else>绑定 GitHub 后可查看和更新公开资料。</p>
      </div>
    </div>

    <GitHubAccountProfileEditor v-if="workspace.githubBinding.value" />
    <div v-else class="card profile-page__unavailable" role="status">
      <div>
        <h2>GitHub 尚未绑定</h2>
        <p>完成账户绑定后即可管理公开资料。</p>
      </div>
      <RouterLink
        :to="{ path: '/settings', query: { tab: 'account' } }"
        class="primary profile-page__settings"
        data-agent-id="profile.open-account-settings"
      >
        前往账户设置
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.profile-page {
  min-width: 0;
  padding: 20px;
}

.profile-page > .page-header {
  margin-bottom: 14px;
}

.profile-page__unavailable {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.profile-page__unavailable h2,
.profile-page__unavailable p {
  margin: 0;
}

.profile-page__unavailable h2 {
  font-size: 14px;
}

.profile-page__unavailable p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.profile-page__settings {
  flex: 0 0 auto;
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  text-decoration: none;
}

@media (max-width: 680px) {
  .profile-page {
    padding: 14px;
  }

  .profile-page__unavailable {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
