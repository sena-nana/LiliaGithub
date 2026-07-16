<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import OrganizationOverview from "../components/organization/OrganizationOverview.vue";
import { useWorkspace } from "../composables/useWorkspace";

const route = useRoute();
const workspace = useWorkspace();
</script>

<template>
  <section class="organization-page" data-agent-id="organization.page">
    <div class="organization-page__inner">
      <div v-if="!workspace.githubBinding.value" class="card organization-page__unavailable" role="status">
        <div>
          <h1>GitHub 尚未绑定</h1>
          <p>完成账户绑定后才能读取组织资料和仓库。</p>
        </div>
        <RouterLink
          :to="{ path: '/settings', query: { tab: 'account' } }"
          class="primary organization-page__settings"
          data-agent-id="organization.open-account-settings"
        >
          前往账户设置
        </RouterLink>
      </div>

      <OrganizationOverview v-else :login="String(route.params.login ?? '')" />
    </div>
  </section>
</template>

<style scoped>
.organization-page {
  min-width: 0;
  padding: 20px;
}

.organization-page__inner {
  width: min(100%, 1160px);
  margin: 0 auto;
}

.organization-page__unavailable {
  min-height: 104px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.organization-page__unavailable h1,
.organization-page__unavailable p {
  margin: 0;
}

.organization-page__unavailable h1 {
  font-size: 15px;
  font-weight: 600;
}

.organization-page__unavailable p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.organization-page__settings {
  min-height: 30px;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 10px;
  text-decoration: none;
}

@media (max-width: 680px) {
  .organization-page {
    padding: 14px;
  }

  .organization-page__unavailable {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
