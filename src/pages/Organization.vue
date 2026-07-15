<script setup lang="ts">
import { Building2, LoaderCircle } from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import GitHubRepositoryStateNotice from "../components/github/GitHubRepositoryStateNotice.vue";
import { useComponentEpoch } from "../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import { useWorkspace } from "../composables/useWorkspace";
import {
  listGitHubRepos,
  type GitHubRepoSummary,
  type RepoSummary,
} from "../services/workspace";
import {
  githubRepositoryPermissionLabel,
  githubUserFacingError,
} from "../utils/githubRepositoryScope";
import {
  githubRepositoryIdentityKey,
  remoteRepoRoute,
  shortcutFromGitHubRepo,
} from "../utils/remoteRepo";
import { repoRoute } from "../utils/repoRoutes";
import { representativeReposByGitHubFullName } from "../utils/repoWorktree";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const repositoriesLoader = createLatestAsyncLoader({ componentEpoch });
const repositories = ref<GitHubRepoSummary[]>([]);
const nextPage = ref<number | null>(1);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref<string | null>(null);
const openingRepository = ref<string | null>(null);
const openError = ref<string | null>(null);
const loadedPages = new Set<number>();

const organizationLogin = computed(() => String(route.params.login ?? "").trim());
const bindingIdentity = computed(() => {
  const binding = workspace.githubBinding.value;
  return binding
    ? `${binding.login.toLocaleLowerCase()}:${binding.boundAt}:${[...binding.scopes].sort().join(",")}`
    : "unbound";
});
const requestIdentity = computed(() => `${bindingIdentity.value}:${organizationLogin.value.toLocaleLowerCase()}`);
const localRepositoriesByFullName = computed(() =>
  representativeReposByGitHubFullName(workspace.state.repos),
);
const repositoryRows = computed(() =>
  [...repositories.value]
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
    .map((repository) => ({
      repository,
      localRepository: localRepositoriesByFullName.value.get(githubRepositoryIdentityKey(repository.fullName)) ?? null,
    })),
);

function mergeRepositories(current: readonly GitHubRepoSummary[], incoming: readonly GitHubRepoSummary[]) {
  const merged = new Map(current.map((repository) => [githubRepositoryIdentityKey(repository.fullName), repository]));
  for (const repository of incoming) {
    merged.set(githubRepositoryIdentityKey(repository.fullName), repository);
  }
  return [...merged.values()];
}

function resetRepositories() {
  repositoriesLoader.invalidate();
  repositories.value = [];
  nextPage.value = 1;
  loading.value = false;
  loaded.value = false;
  loadError.value = null;
  openingRepository.value = null;
  openError.value = null;
  loadedPages.clear();
}

async function loadNextPage() {
  const binding = workspace.githubBinding.value;
  const login = organizationLogin.value;
  const pageNumber = nextPage.value;
  if (!binding || !login || pageNumber === null || loading.value) return;
  if (loadedPages.has(pageNumber)) {
    nextPage.value = null;
    return;
  }

  const identity = requestIdentity.value;
  await repositoriesLoader.run(`${identity}:${pageNumber}`, async (runId) => {
    loading.value = true;
    loadError.value = null;
    try {
      const page = await listGitHubRepos({ kind: "organization", login }, pageNumber);
      if (!repositoriesLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      repositories.value = mergeRepositories(repositories.value, page.items);
      loadedPages.add(pageNumber);
      nextPage.value = page.nextPage !== null
        && page.nextPage !== pageNumber
        && !loadedPages.has(page.nextPage)
        ? page.nextPage
        : null;
      loaded.value = true;
    } catch (err) {
      if (!repositoriesLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      loadError.value = `仓库加载失败：${githubUserFacingError(err)}`;
    } finally {
      if (repositoriesLoader.isCurrent(runId) && requestIdentity.value === identity) loading.value = false;
    }
  });
}

async function openRepository(repository: GitHubRepoSummary, localRepository: RepoSummary | null) {
  if (openingRepository.value) return;
  const identity = requestIdentity.value;
  const repositoryKey = repository.fullName;
  openError.value = null;
  openingRepository.value = repositoryKey;
  try {
    if (localRepository) {
      await router.push(repoRoute(localRepository.id));
      return;
    }
    await workspace.rememberRemoteRepo(shortcutFromGitHubRepo(repository));
    if (!componentEpoch.assertAlive() || requestIdentity.value !== identity) return;
    await router.push(remoteRepoRoute(repository.fullName));
  } catch (err) {
    if (componentEpoch.assertAlive() && requestIdentity.value === identity) {
      openError.value = `无法打开仓库：${githubUserFacingError(err)}`;
    }
  } finally {
    if (
      componentEpoch.assertAlive()
      && requestIdentity.value === identity
      && openingRepository.value === repositoryKey
    ) {
      openingRepository.value = null;
    }
  }
}

watch(
  requestIdentity,
  () => {
    resetRepositories();
    if (workspace.githubBinding.value && organizationLogin.value) void loadNextPage();
  },
  { immediate: true },
);

onUnmounted(() => repositoriesLoader.invalidate());
</script>

<template>
  <section class="organization-page" data-agent-id="organization.page">
    <div class="page-header organization-page__header">
      <div class="organization-page__identity">
        <Building2 :size="22" aria-hidden="true" />
        <div>
          <h1>{{ organizationLogin || "组织" }}</h1>
          <p>查看当前账户可访问的组织仓库。</p>
        </div>
      </div>
      <span v-if="loaded" class="organization-page__count">
        {{ nextPage === null ? `${repositories.length} 个仓库` : `已加载 ${repositories.length} 个` }}
      </span>
    </div>

    <div v-if="!workspace.githubBinding.value" class="card organization-page__unavailable" role="status">
      <div>
        <h2>GitHub 尚未绑定</h2>
        <p>完成账户绑定后才能读取组织仓库。</p>
      </div>
      <RouterLink
        :to="{ path: '/settings', query: { tab: 'account' } }"
        class="primary organization-page__settings"
        data-agent-id="organization.open-account-settings"
      >
        前往账户设置
      </RouterLink>
    </div>

    <section v-else class="card organization-page__repositories" aria-label="组织仓库">
      <GitHubRepositoryStateNotice
        v-if="loading && !repositoryRows.length"
        state="loading"
        message="正在加载组织仓库…"
        agent-id="organization.repositories.loading"
      />
      <GitHubRepositoryStateNotice
        v-else-if="loadError && !repositoryRows.length"
        state="error"
        retryable
        :message="loadError"
        agent-id="organization.repositories.error"
        @retry="loadNextPage"
      />
      <GitHubRepositoryStateNotice
        v-else-if="loaded && !repositoryRows.length"
        state="empty"
        message="该组织没有可见仓库。"
        agent-id="organization.repositories.empty"
      />

      <div v-if="repositoryRows.length" class="organization-repository-list">
        <button
          v-for="{ repository, localRepository } in repositoryRows"
          :key="repository.fullName"
          type="button"
          class="organization-repository-row"
          :title="localRepository?.path ?? repository.htmlUrl"
          :data-agent-id="`organization.repository.${repository.fullName}`"
          :disabled="openingRepository !== null"
          @click="openRepository(repository, localRepository)"
        >
          <span class="organization-repository-row__identity">
            <strong>{{ repository.name }}</strong>
            <small>{{ repository.fullName }}</small>
          </span>
          <span class="organization-repository-row__status">
            <span class="organization-repository-row__badge" :class="{ 'is-local': localRepository }">
              {{ localRepository ? "本地" : "远程" }}
            </span>
            <span v-if="repository.private" class="organization-repository-row__badge">私有</span>
            <span v-if="repository.archived" class="organization-repository-row__badge">已归档</span>
            <span v-if="githubRepositoryPermissionLabel(repository.permissions)" class="organization-repository-row__badge">
              {{ githubRepositoryPermissionLabel(repository.permissions) }}
            </span>
            <LoaderCircle
              v-if="openingRepository === repository.fullName"
              :size="13"
              aria-label="正在打开"
              class="sb-spin"
            />
          </span>
        </button>
      </div>

      <GitHubRepositoryStateNotice
        v-if="loadError && repositoryRows.length"
        state="error"
        compact
        retryable
        :message="loadError"
        agent-id="organization.repositories.more-error"
        @retry="loadNextPage"
      />
      <p v-if="openError" class="organization-page__open-error" role="alert">{{ openError }}</p>
      <button
        v-if="nextPage !== null && repositoryRows.length && !loadError"
        type="button"
        class="ghost organization-page__more"
        data-agent-id="organization.repositories.load-more"
        :disabled="loading"
        @click="loadNextPage"
      >
        <LoaderCircle v-if="loading" :size="13" aria-hidden="true" class="sb-spin" />
        {{ loading ? "正在加载" : "加载更多" }}
      </button>
    </section>
  </section>
</template>

<style scoped>
.organization-page {
  min-width: 0;
  padding: 20px;
}

.organization-page__header,
.organization-page__identity,
.organization-page__unavailable,
.organization-repository-row,
.organization-repository-row__status {
  display: flex;
  align-items: center;
}

.organization-page__header,
.organization-page__unavailable,
.organization-repository-row {
  justify-content: space-between;
}

.organization-page__header {
  gap: 16px;
  margin-bottom: 14px;
}

.organization-page__identity {
  min-width: 0;
  gap: 9px;
}

.organization-page__count {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 12px;
}

.organization-page__unavailable {
  gap: 16px;
}

.organization-page__unavailable h2,
.organization-page__unavailable p {
  margin: 0;
}

.organization-page__unavailable h2 {
  font-size: 14px;
}

.organization-page__unavailable p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.organization-page__settings {
  flex: 0 0 auto;
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  text-decoration: none;
}

.organization-page__repositories {
  min-height: 120px;
  padding: 8px;
}

.organization-repository-list {
  display: grid;
  gap: 1px;
}

.organization-repository-row {
  width: 100%;
  min-height: 48px;
  gap: 12px;
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  color: var(--text);
  background: transparent;
  text-align: left;
  transition: background-color 0.12s ease;
}

.organization-repository-row:hover,
.organization-repository-row:focus-visible {
  background: var(--bg-hover);
}

.organization-repository-row:disabled {
  cursor: default;
}

.organization-repository-row__identity {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.organization-repository-row__identity strong,
.organization-repository-row__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-repository-row__identity strong {
  font-size: 13px;
  font-weight: 600;
}

.organization-repository-row__identity small {
  color: var(--text-muted);
  font-size: 11px;
}

.organization-repository-row__status {
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 5px;
}

.organization-repository-row__badge {
  min-height: 18px;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--bg-subtle);
  font-size: 10px;
}

.organization-repository-row__badge.is-local {
  color: var(--ok);
  background: var(--ok-soft);
}

.organization-page__open-error {
  margin: 8px 4px 0;
  color: var(--err);
  font-size: 12px;
}

.organization-page__more {
  width: 100%;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 680px) {
  .organization-page {
    padding: 14px;
  }

  .organization-page__unavailable,
  .organization-repository-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .organization-repository-row__status {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .organization-repository-row,
  .sb-spin {
    transition: none;
    animation: none;
  }
}
</style>
