<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Building2, ChevronRight, FolderGit2, GitBranch, GitPullRequestArrow, Lock, UserRound } from "@lucide/vue";
import { SidebarCollapse } from "@lilia/ui";
import type { GitHubRepoOwner, GitHubRepoSummary, GitHubRepositoryScope, RepoSummary } from "../../services/workspace";
import { repoDisplayInfo } from "../../utils/repoDisplay";
import {
  githubOrganizationAccessMessage,
  githubOrganizationAccessRecovery,
  githubRepositoryPermissionLabel,
} from "../../utils/githubRepositoryScope";
import GitHubRepositoryStateNotice from "../github/GitHubRepositoryStateNotice.vue";

export interface GitHubOwnerRepositoryState {
  items: readonly GitHubRepoSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const props = defineProps<{
  accountLogin: string;
  owners: readonly GitHubRepoOwner[];
  localRepos: readonly RepoSummary[];
  repositoriesByOwner: Readonly<Record<string, GitHubOwnerRepositoryState | undefined>>;
  organizationAccessLimited?: boolean;
}>();

const emit = defineEmits<{
  selectScope: [scope: GitHubRepositoryScope];
  loadOwner: [owner: GitHubRepoOwner];
  openLocal: [repo: RepoSummary];
  openRemote: [repo: GitHubRepoSummary];
  authorize: [recoveryUrl: string | null];
}>();

const STORAGE_PREFIX = "lilia-github.sidebar.githubOwners.collapsed.v1";

function collapsedStorageKey() {
  return `${STORAGE_PREFIX}:${props.accountLogin || "unbound"}`;
}

function readCollapsedOwners() {
  try {
    const stored = window.localStorage.getItem(collapsedStorageKey());
    if (stored === null) return null;
    const values = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return null;
  }
}

const collapsedOwners = ref(readCollapsedOwners());

watch(
  () => props.accountLogin,
  () => {
    collapsedOwners.value = readCollapsedOwners();
  },
);

const sortedOwners = computed(() =>
  [...props.owners].sort((left, right) => (
    Number(left.kind !== "user") - Number(right.kind !== "user")
    || left.login.localeCompare(right.login)
  )),
);
const organizationRecovery = computed(() => githubOrganizationAccessRecovery(props.owners));
const organizationAccessMessage = computed(() => githubOrganizationAccessMessage(props.owners));

watch(
  [() => props.accountLogin, sortedOwners],
  () => {
    for (const owner of sortedOwners.value) {
      if (ownerIsCollapsed(owner)) continue;
      const state = props.repositoriesByOwner[owner.login];
      if (!state?.loaded && !state?.loading) emit("loadOwner", owner);
    }
  },
  { immediate: true },
);

function localRepos(owner: GitHubRepoOwner) {
  const prefix = `${owner.login.toLocaleLowerCase()}/`;
  return props.localRepos.filter((repo) => repo.githubFullName?.toLocaleLowerCase().startsWith(prefix));
}

function remoteRepos(owner: GitHubRepoOwner) {
  const localFullNames = new Set(localRepos(owner).map((repo) => repo.githubFullName?.toLocaleLowerCase()));
  return (props.repositoriesByOwner[owner.login]?.items ?? [])
    .filter((repo) => !localFullNames.has(repo.fullName.toLocaleLowerCase()));
}

function ownerScope(owner: GitHubRepoOwner): GitHubRepositoryScope {
  return owner.kind === "user"
    ? { kind: "personal", login: owner.login }
    : { kind: "organization", login: owner.login };
}

function ownerIsCollapsed(owner: GitHubRepoOwner) {
  return collapsedOwners.value?.has(owner.login) ?? true;
}

function persistCollapsedOwners(next: Set<string>) {
  collapsedOwners.value = next;
  try {
    window.localStorage.setItem(collapsedStorageKey(), JSON.stringify([...next]));
  } catch {
    // The sidebar remains usable when persistence is unavailable.
  }
}

function currentCollapsedOwners() {
  return collapsedOwners.value
    ? new Set(collapsedOwners.value)
    : new Set(sortedOwners.value.map((owner) => owner.login));
}

function selectOwner(owner: GitHubRepoOwner) {
  emit("selectScope", ownerScope(owner));
  if (ownerIsCollapsed(owner)) {
    const next = currentCollapsedOwners();
    next.delete(owner.login);
    persistCollapsedOwners(next);
  }
  const state = props.repositoriesByOwner[owner.login];
  if (!state?.loaded && !state?.loading) emit("loadOwner", owner);
}

function toggleOwner(owner: GitHubRepoOwner) {
  const next = currentCollapsedOwners();
  if (next.has(owner.login)) {
    next.delete(owner.login);
    const state = props.repositoriesByOwner[owner.login];
    if (!state?.loaded && !state?.loading) emit("loadOwner", owner);
  } else {
    next.add(owner.login);
  }
  persistCollapsedOwners(next);
}

function retryOwner(owner: GitHubRepoOwner) {
  emit("loadOwner", owner);
}

function ownerSourceLabel(owner: GitHubRepoOwner) {
  return owner.source === "repository_access" ? "仓库访问" : null;
}

function ownerRepoCountLabel(owner: GitHubRepoOwner) {
  const remoteCount = props.repositoriesByOwner[owner.login]?.loaded
    ? String(props.repositoriesByOwner[owner.login]?.items.length ?? 0)
    : "…";
  return `${localRepos(owner).length}/${remoteCount}`;
}

function localRepoIcon(repo: RepoSummary) {
  const source = repoDisplayInfo(repo).source;
  if (source === "worktree") return GitBranch;
  if (source === "remote") return GitPullRequestArrow;
  return FolderGit2;
}
</script>

<template>
  <section v-if="sortedOwners.length" class="github-owner-sidebar" aria-label="GitHub 账号与组织">
    <div class="github-owner-sidebar__title">GitHub</div>
    <GitHubRepositoryStateNotice
      v-if="organizationAccessLimited"
      state="limited"
      compact
      :message="organizationAccessMessage"
      :action-label="organizationRecovery.url ? '在 GitHub 授权' : '补充组织权限'"
      @authorize="emit('authorize', organizationRecovery.url)"
    />
    <div v-for="owner in sortedOwners" :key="owner.login" class="github-owner-sidebar__owner">
      <div class="github-owner-sidebar__owner-header">
        <button
          type="button"
          class="github-owner-sidebar__owner-main"
          :data-agent-id="`sidebar.github-owner.${owner.login}`"
          @click="selectOwner(owner)"
        >
          <img v-if="owner.avatarUrl" :src="owner.avatarUrl" alt="" />
          <UserRound v-else-if="owner.kind === 'user'" :size="14" aria-hidden="true" />
          <Building2 v-else :size="14" aria-hidden="true" />
          <span>{{ owner.login }}</span>
          <small v-if="ownerSourceLabel(owner)">{{ ownerSourceLabel(owner) }}</small>
          <span class="github-owner-sidebar__counts">
            {{ ownerRepoCountLabel(owner) }}
          </span>
        </button>
        <button
          type="button"
          class="github-owner-sidebar__toggle"
          :aria-label="`${ownerIsCollapsed(owner) ? '展开' : '折叠'} ${owner.login}`"
          :aria-expanded="!ownerIsCollapsed(owner)"
          :data-agent-id="`sidebar.github-owner.${owner.login}.toggle`"
          @click="toggleOwner(owner)"
        >
          <ChevronRight
            :size="13"
            aria-hidden="true"
            :class="{ 'is-open': !ownerIsCollapsed(owner) }"
          />
        </button>
      </div>
      <SidebarCollapse :open="!ownerIsCollapsed(owner)">
        <div class="github-owner-sidebar__repos">
          <button
            v-for="repo in localRepos(owner)"
            :key="`local:${repo.id}`"
            type="button"
            class="github-owner-sidebar__repo"
            :title="repo.path"
            :data-agent-id="`sidebar.github-owner.${owner.login}.local.${repo.id}`"
            @click="emit('openLocal', repo)"
          >
            <component :is="localRepoIcon(repo)" :size="13" aria-hidden="true" />
            <span>{{ repoDisplayInfo(repo).name }}</span>
            <small>本地</small>
          </button>
          <button
            v-for="repo in remoteRepos(owner)"
            :key="`remote:${repo.id}`"
            type="button"
            class="github-owner-sidebar__repo"
            :title="repo.fullName"
            :data-agent-id="`sidebar.github-owner.${owner.login}.remote.${repo.id}`"
            @click="emit('openRemote', repo)"
          >
            <GitPullRequestArrow :size="13" aria-hidden="true" />
            <span>{{ repo.name }}</span>
            <Lock v-if="repo.private" :size="10" aria-label="私有" />
            <small v-if="repo.archived">已归档</small>
            <small v-if="githubRepositoryPermissionLabel(repo.permissions)">
              {{ githubRepositoryPermissionLabel(repo.permissions) }}
            </small>
          </button>
          <GitHubRepositoryStateNotice
            v-if="!repositoriesByOwner[owner.login] || repositoriesByOwner[owner.login]?.loading"
            state="loading"
            compact
            message="正在加载远程仓库…"
          />
          <GitHubRepositoryStateNotice
            v-else-if="repositoriesByOwner[owner.login]?.error"
            state="error"
            compact
            retryable
            :message="repositoriesByOwner[owner.login]?.error ?? ''"
            @retry="retryOwner(owner)"
          />
          <GitHubRepositoryStateNotice
            v-else-if="repositoriesByOwner[owner.login]?.loaded && !localRepos(owner).length && !remoteRepos(owner).length"
            state="empty"
            compact
          />
        </div>
      </SidebarCollapse>
    </div>
  </section>
</template>

<style scoped>
.github-owner-sidebar {
  display: grid;
  gap: 3px;
  padding: 8px 6px;
  border-top: 1px solid var(--border-soft);
}

.github-owner-sidebar__title {
  padding: 0 6px 4px;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.github-owner-sidebar__owner-header {
  display: flex;
  align-items: center;
  gap: 2px;
}

.github-owner-sidebar__owner-main,
.github-owner-sidebar__toggle,
.github-owner-sidebar__repo {
  border: 0;
  color: var(--text-muted);
  background: transparent;
}

.github-owner-sidebar__owner-main {
  min-width: 0;
  min-height: 30px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 6px;
  border-radius: 6px;
  text-align: left;
}

.github-owner-sidebar__owner-main:hover,
.github-owner-sidebar__toggle:hover,
.github-owner-sidebar__repo:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.github-owner-sidebar__owner-main img {
  width: 18px;
  height: 18px;
  border-radius: 5px;
}

.github-owner-sidebar__owner-main > span:first-of-type {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.github-owner-sidebar__owner-main small {
  padding: 1px 4px;
  border-radius: 4px;
  color: var(--text-faint);
  background: var(--bg-subtle);
  font-size: 9px;
  white-space: nowrap;
}

.github-owner-sidebar__counts {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 10px;
}

.github-owner-sidebar__toggle {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
}

.github-owner-sidebar__toggle svg {
  transition: transform 0.12s;
}

.github-owner-sidebar__toggle svg.is-open {
  transform: rotate(90deg);
}

.github-owner-sidebar__repos {
  display: grid;
  gap: 2px;
  padding: 2px 0 5px 16px;
}

.github-owner-sidebar__repo {
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 7px;
  border-radius: 6px;
  text-align: left;
}

.github-owner-sidebar__repo span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.github-owner-sidebar__repo small {
  color: var(--text-faint);
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .github-owner-sidebar__toggle svg {
    transition: none;
  }
}
</style>
