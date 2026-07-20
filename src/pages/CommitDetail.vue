<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@lucide/vue";
import CommitDetailCard from "../components/repo/CommitDetailCard.vue";
import { useWorkspace } from "../composables/useWorkspace";
import { repoDisplayName } from "../utils/repoDisplay";
import { repoRoute } from "../utils/repoRoutes";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspace();

const repoId = computed(() => String(route.params.repoId ?? ""));
const hash = computed(() => String(route.params.hash ?? ""));
const summary = computed(() => workspace.repoById(repoId.value));
const repoTitle = computed(() => repoDisplayName(summary.value) || repoId.value);

function returnToHistory() {
  void router.replace(repoRoute(repoId.value, "history"));
}
</script>

<template>
  <section class="commit-detail-page">
    <header class="commit-detail-header">
      <RouterLink class="ghost commit-detail-back" :to="repoRoute(repoId, 'history')">
        <ArrowLeft :size="14" aria-hidden="true" />
        返回历史
      </RouterLink>
      <div class="commit-detail-header__identity">
        <p>{{ repoTitle }}</p>
        <h1>提交详情</h1>
      </div>
    </header>

    <CommitDetailCard
      :repo-id="repoId"
      :repo-title="repoTitle"
      :hash="hash"
      @missing="returnToHistory"
    />
  </section>
</template>

<style scoped>
.commit-detail-page {
  display: grid;
  gap: 14px;
}

.commit-detail-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.commit-detail-back {
  flex: 0 0 auto;
  text-decoration: none;
}

.commit-detail-header__identity {
  min-width: 0;
}

.commit-detail-header__identity p {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.commit-detail-header__identity h1 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 18px;
  font-weight: 600;
}

@media (max-width: 760px) {
  .commit-detail-header {
    display: grid;
  }
}
</style>
