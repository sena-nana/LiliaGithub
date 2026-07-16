<script setup lang="ts">
import {
  Archive,
  BookMarked,
  Code2,
  GitFork,
  LoaderCircle,
  Search,
  Star,
} from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import GitHubRepositoryStateNotice from "../github/GitHubRepositoryStateNotice.vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  listGitHubRepos,
  type GitHubRepoSummary,
  type GitHubRepoPage,
  type RepoSummary,
} from "../../services/workspace";
import {
  githubRepositoryPermissionLabel,
} from "../../utils/githubRepositoryScope";
import {
  githubRepositoryIdentityKey,
  remoteRepoRoute,
  shortcutFromGitHubRepo,
} from "../../utils/remoteRepo";
import { repoRoute } from "../../utils/repoRoutes";
import { representativeReposByGitHubFullName } from "../../utils/repoWorktree";

type RepositoryType = "all" | "public" | "private" | "sources" | "forks" | "archived" | "templates";
type RepositorySort = "updated" | "name" | "stars";

const props = defineProps<{ login: string }>();
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
const search = ref("");
const typeFilter = ref<RepositoryType>("all");
const languageFilter = ref("");
const sort = ref<RepositorySort>("updated");

const organizationLogin = computed(() => props.login.trim());
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
const languageOptions = computed(() => [...new Set(
  repositories.value.map((repository) => repository.language?.trim()).filter((value): value is string => Boolean(value)),
)].sort((left, right) => left.localeCompare(right)));
const repositoryRows = computed(() => {
  const normalizedSearch = search.value.trim().toLocaleLowerCase();
  return repositories.value
    .filter((repository) => {
      if (normalizedSearch) {
        const searchable = [
          repository.name,
          repository.fullName,
          repository.description ?? "",
          ...(repository.topics ?? []),
        ].join(" ").toLocaleLowerCase();
        if (!searchable.includes(normalizedSearch)) return false;
      }
      if (languageFilter.value && repository.language !== languageFilter.value) return false;
      if (typeFilter.value === "public" && repositoryVisibility(repository) !== "public") return false;
      if (typeFilter.value === "private" && repositoryVisibility(repository) !== "private") return false;
      if (typeFilter.value === "sources" && repository.fork) return false;
      if (typeFilter.value === "forks" && !repository.fork) return false;
      if (typeFilter.value === "archived" && !repository.archived) return false;
      if (typeFilter.value === "templates" && !repository.isTemplate) return false;
      return true;
    })
    .sort(compareRepositories)
    .map((repository) => ({
      repository,
      localRepository: localRepositoriesByFullName.value.get(githubRepositoryIdentityKey(repository.fullName)) ?? null,
    }));
});

function repositoryVisibility(repository: GitHubRepoSummary) {
  const visibility = repository.visibility?.trim().toLocaleLowerCase();
  if (visibility === "public" || visibility === "private" || visibility === "internal") {
    return visibility;
  }
  return repository.private ? "private" : "public";
}

function compareRepositories(left: GitHubRepoSummary, right: GitHubRepoSummary) {
  if (sort.value === "stars") {
    return (right.stargazersCount ?? 0) - (left.stargazersCount ?? 0)
      || left.fullName.localeCompare(right.fullName);
  }
  if (sort.value === "name") return left.fullName.localeCompare(right.fullName);
  return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0)
    || left.fullName.localeCompare(right.fullName);
}

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
  search.value = "";
  typeFilter.value = "all";
  languageFilter.value = "";
  sort.value = "updated";
}

async function loadRepositories() {
  const binding = workspace.githubBinding.value;
  const login = organizationLogin.value;
  const firstPage = nextPage.value;
  if (!binding || !login || firstPage === null || loading.value) return;

  const identity = requestIdentity.value;
  await repositoriesLoader.run(identity, async (runId) => {
    loading.value = true;
    loadError.value = null;
    let pageNumber: number | null = firstPage;
    const visitedPages = new Set<number>();
    try {
      while (pageNumber !== null && !visitedPages.has(pageNumber)) {
        visitedPages.add(pageNumber);
        const page: GitHubRepoPage = await listGitHubRepos({ kind: "organization", login }, pageNumber);
        if (!repositoriesLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
        repositories.value = mergeRepositories(repositories.value, page.items);
        loaded.value = true;
        const candidate: number | null = page.nextPage;
        nextPage.value = candidate !== null && candidate !== pageNumber && !visitedPages.has(candidate)
          ? candidate
          : null;
        pageNumber = nextPage.value;
      }
    } catch {
      if (!repositoriesLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      nextPage.value = pageNumber;
      loadError.value = "暂时无法读取组织仓库，请重试。";
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
  } catch {
    if (componentEpoch.assertAlive() && requestIdentity.value === identity) {
      openError.value = "无法打开仓库，请稍后重试。";
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

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "更新时间未知";
  return `更新于 ${new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}

function repositoryAgentKey(repository: GitHubRepoSummary) {
  return repository.fullName.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

watch(
  requestIdentity,
  () => {
    resetRepositories();
    if (workspace.githubBinding.value && organizationLogin.value) void loadRepositories();
  },
  { immediate: true },
);

onUnmounted(() => repositoriesLoader.invalidate());
</script>

<template>
  <section class="organization-repositories" aria-labelledby="organization-repositories-title">
    <header class="organization-repositories__header">
      <div>
        <p class="organization-repositories__eyebrow">{{ organizationLogin }}</p>
        <h1 id="organization-repositories-title">Repositories</h1>
      </div>
      <span v-if="loaded" class="organization-repositories__count">
        {{ loading ? `已加载 ${repositories.length} 个` : `${repositories.length} 个仓库` }}
      </span>
    </header>

    <div class="organization-repositories__filters" aria-label="仓库筛选">
      <label class="organization-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">搜索仓库</span>
        <input
          v-model="search"
          type="search"
          placeholder="搜索仓库"
          data-agent-id="organization.repositories.search"
        >
      </label>
      <label>
        <span class="sr-only">仓库类型</span>
        <select v-model="typeFilter" data-agent-id="organization.repositories.type-filter">
          <option value="all">所有类型</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="sources">Sources</option>
          <option value="forks">Forks</option>
          <option value="archived">Archived</option>
          <option value="templates">Templates</option>
        </select>
      </label>
      <label>
        <span class="sr-only">编程语言</span>
        <select v-model="languageFilter" data-agent-id="organization.repositories.language-filter">
          <option value="">所有语言</option>
          <option v-for="language in languageOptions" :key="language" :value="language">{{ language }}</option>
        </select>
      </label>
      <label>
        <span class="sr-only">仓库排序</span>
        <select v-model="sort" data-agent-id="organization.repositories.sort">
          <option value="updated">最近更新</option>
          <option value="name">名称</option>
          <option value="stars">Stars</option>
        </select>
      </label>
    </div>

    <GitHubRepositoryStateNotice
      v-if="loading && !repositories.length"
      state="loading"
      message="正在加载组织仓库…"
      agent-id="organization.repositories.loading"
    />
    <GitHubRepositoryStateNotice
      v-else-if="loadError && !repositories.length"
      state="error"
      retryable
      :message="loadError"
      agent-id="organization.repositories.retry"
      @retry="loadRepositories"
    />
    <GitHubRepositoryStateNotice
      v-else-if="loaded && !repositories.length"
      state="empty"
      message="该组织没有可见仓库。"
      agent-id="organization.repositories.empty"
    />
    <GitHubRepositoryStateNotice
      v-else-if="loaded && !repositoryRows.length"
      state="empty"
      message="没有符合当前筛选条件的仓库。"
      agent-id="organization.repositories.no-results"
    />

    <div v-if="repositoryRows.length" class="organization-repository-list" aria-label="组织仓库">
      <button
        v-for="{ repository, localRepository } in repositoryRows"
        :key="repository.fullName"
        type="button"
        class="organization-repository-row"
        :title="localRepository?.path ?? repository.htmlUrl"
        :data-agent-id="`organization.repositories.row.${repositoryAgentKey(repository)}`"
        :disabled="openingRepository !== null"
        @click="openRepository(repository, localRepository)"
      >
        <span class="organization-repository-row__main">
          <span class="organization-repository-row__heading">
            <strong>{{ repository.name }}</strong>
            <span class="organization-repository-row__badge" :class="{ 'is-local': localRepository }">
              {{ localRepository ? "本地" : "远程" }}
            </span>
            <span v-if="repositoryVisibility(repository) === 'private'" class="organization-repository-row__badge">Private</span>
            <span v-else-if="repositoryVisibility(repository) === 'internal'" class="organization-repository-row__badge">Internal</span>
            <span v-if="repository.archived" class="organization-repository-row__badge">Archived</span>
            <span v-if="repository.isTemplate" class="organization-repository-row__badge">Template</span>
            <span v-if="githubRepositoryPermissionLabel(repository.permissions)" class="organization-repository-row__badge">
              {{ githubRepositoryPermissionLabel(repository.permissions) }}
            </span>
          </span>
          <span v-if="repository.description" class="organization-repository-row__description">
            {{ repository.description }}
          </span>
          <span class="organization-repository-row__meta">
            <span v-if="repository.language"><Code2 :size="12" aria-hidden="true" />{{ repository.language }}</span>
            <span v-if="repository.stargazersCount"><Star :size="12" aria-hidden="true" />{{ repository.stargazersCount }}</span>
            <span v-if="repository.forksCount"><GitFork :size="12" aria-hidden="true" />{{ repository.forksCount }}</span>
            <span v-if="repository.licenseSpdxId"><BookMarked :size="12" aria-hidden="true" />{{ repository.licenseSpdxId }}</span>
            <span v-if="repository.archived"><Archive :size="12" aria-hidden="true" />只读</span>
            <span>{{ formatUpdatedAt(repository.updatedAt) }}</span>
          </span>
        </span>
        <LoaderCircle
          v-if="openingRepository === repository.fullName"
          :size="15"
          aria-label="正在打开"
          class="sb-spin"
        />
      </button>
    </div>

    <GitHubRepositoryStateNotice
      v-if="loadError && repositories.length"
      state="error"
      compact
      retryable
      :message="loadError"
      agent-id="organization.repositories.retry-more"
      @retry="loadRepositories"
    />
    <p v-if="openError" class="organization-repositories__error" role="alert">{{ openError }}</p>
    <p v-if="loading && repositories.length" class="organization-repositories__progress" role="status">
      <LoaderCircle :size="13" aria-hidden="true" class="sb-spin" />
      正在读取全部仓库，已加载 {{ repositories.length }} 个…
    </p>
  </section>
</template>

<style scoped>
.organization-repositories {
  min-width: 0;
}

.organization-repositories__header,
.organization-repository-row,
.organization-repository-row__heading,
.organization-repository-row__meta,
.organization-repositories__progress {
  display: flex;
  align-items: center;
}

.organization-repositories__header {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.organization-repositories__eyebrow,
.organization-repositories__header h1 {
  margin: 0;
}

.organization-repositories__eyebrow {
  margin-bottom: 2px;
  color: var(--text-muted);
  font-size: 11px;
}

.organization-repositories__header h1 {
  font-size: 18px;
  font-weight: 600;
}

.organization-repositories__count,
.organization-repositories__progress {
  color: var(--text-muted);
  font-size: 12px;
}

.organization-repositories__filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) repeat(3, auto);
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-soft);
}

.organization-search {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  background: var(--bg-elev);
}

.organization-search:focus-within {
  border-color: var(--accent);
}

.organization-search input {
  min-width: 0;
  width: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--text);
  background: transparent;
  font: inherit;
}

select {
  min-height: 32px;
  padding: 0 28px 0 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: var(--bg-elev);
  font: inherit;
}

.organization-repository-list {
  display: grid;
}

.organization-repository-row {
  width: 100%;
  min-width: 0;
  min-height: 86px;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 4px;
  border: 0;
  border-bottom: 1px solid var(--border-soft);
  border-radius: 0;
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

.organization-repository-row__main {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.organization-repository-row__heading,
.organization-repository-row__meta {
  min-width: 0;
  flex-wrap: wrap;
  gap: 7px;
}

.organization-repository-row__heading strong {
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
}

.organization-repository-row__description {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-repository-row__meta {
  color: var(--text-muted);
  font-size: 11px;
}

.organization-repository-row__meta > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.organization-repository-row__badge {
  min-height: 18px;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10px;
}

.organization-repository-row__badge.is-local {
  border-color: transparent;
  color: var(--ok);
  background: var(--ok-soft);
}

.organization-repositories__error {
  margin: 10px 4px 0;
  color: var(--err);
  font-size: 12px;
}

.organization-repositories__progress {
  justify-content: center;
  gap: 6px;
  min-height: 38px;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

@keyframes sb-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 820px) {
  .organization-repositories__filters {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .organization-search {
    grid-column: 1 / -1;
  }
}

@media (max-width: 560px) {
  .organization-repositories__filters {
    grid-template-columns: 1fr;
  }

  .organization-search {
    grid-column: auto;
  }

  select {
    width: 100%;
  }

  .organization-repository-row__description {
    white-space: normal;
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
