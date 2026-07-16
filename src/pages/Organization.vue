<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import OrganizationOverview from "../components/organization/OrganizationOverview.vue";
import OrganizationRepositories from "../components/organization/OrganizationRepositories.vue";
import { useWorkspace } from "../composables/useWorkspace";

const route = useRoute();
const workspace = useWorkspace();
</script>

<template>
  <section class="organization-page" data-agent-id="organization.page">
    <div class="organization-page__inner">
      <nav v-if="workspace.githubBinding.value" class="organization-tabs" aria-label="组织页面">
        <RouterLink
          :to="{ name: 'github-organization', params: { login: route.params.login } }"
          class="organization-tabs__item"
          data-agent-id="organization.tabs.overview"
        >
          Overview
        </RouterLink>
        <RouterLink
          :to="{ name: 'github-organization-repositories', params: { login: route.params.login } }"
          class="organization-tabs__item"
          data-agent-id="organization.tabs.repositories"
        >
          Repositories
        </RouterLink>
      </nav>

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

      <OrganizationRepositories
        v-else-if="route.name === 'github-organization-repositories'"
        :login="String(route.params.login ?? '')"
      />
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

.organization-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border-soft);
}

.organization-tabs__item {
  position: relative;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: none;
  transition: color 0.12s ease, background-color 0.12s ease;
}

.organization-tabs__item:hover,
.organization-tabs__item:focus-visible {
  color: var(--text);
  background: var(--bg-hover);
}

.organization-tabs__item.router-link-exact-active {
  color: var(--text);
  font-weight: 600;
}

.organization-tabs__item.router-link-exact-active::after {
  position: absolute;
  right: 10px;
  bottom: -1px;
  left: 10px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
  content: "";
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

  .organization-tabs {
    margin-bottom: 14px;
  }

  .organization-page__unavailable {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .organization-tabs__item {
    transition: none;
  }
}
</style>
