<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from "vue-router";
import { computed, nextTick, onUnmounted, ref, shallowRef, watch, type Component } from "vue";
import {
  ArrowDownAZ,
  Building2,
  ChevronRight,
  Clock,
  EyeOff,
  FolderGit2,
  FolderInput,
  GitBranch,
  GitPullRequestArrow,
  LoaderCircle,
  Pencil,
  Plus,
  Star,
  Trash2,
  UserRound,
  X,
} from "@lucide/vue";
import { SIDEBAR_NAV } from "../config/appShell";
import { useWorkspace } from "../composables/useWorkspace";
import {
  bulkSyncRunningRepoIds as getBulkSyncRunningRepoIds,
  repoSyncIssuesByRepoId,
  type RepoSyncIssueDisplay,
} from "../composables/workspace/state";
import SidebarFooter from "../components/sidebar/SidebarFooter.vue";
import RepoSidebarRow from "../components/sidebar/RepoSidebarRow.vue";
import SidebarRowTools from "../components/sidebar/SidebarRowTools.vue";
import GitHubRepositoryStateNotice from "../components/github/GitHubRepositoryStateNotice.vue";
import { SidebarCollapse, openContextMenuAt, type ContextMenuItem, type ContextMenuProvider } from "@lilia/ui";
import { repoDisplayInfo, repoDisplayTitle, type RepoDisplaySource } from "../utils/repoDisplay";
import {
  favoriteRepositories,
  type FavoriteRepositoryEntry,
} from "../utils/repoFavorites";
import { githubRepositoryIdentityKey, parseRemoteRepoId, remoteRepoRoute } from "../utils/remoteRepo";
import { repoRoute } from "../utils/repoRoutes";
import {
  listGitHubRepoOwners,
  type GitHubRepoOwner,
  type RepoSummary,
} from "../services/workspace";
import { useComponentEpoch } from "../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import {
  githubOrganizationAccessLimited,
  githubOrganizationAccessMessage,
  githubOrganizationAccessRecovery,
  githubOrganizationOwners,
  githubUserFacingError,
} from "../utils/githubRepositoryScope";
import {
  DEFAULT_REPO_SORT,
  compareRepoSortItems,
  nextRepoSort,
  nextRepoSortDisplayLabel,
  repoSortDisplayLabel,
  readRepoSort,
  writeRepoSort,
  type RepoSortOption,
  type RepoSortState,
} from "../utils/repoSort";

const workspace = useWorkspace();
const route = useRoute();
const router = useRouter();
const componentEpoch = useComponentEpoch();
const githubOwnersLoader = createLatestAsyncLoader({ componentEpoch, trackSessionContext: false });
const githubOwners = ref<GitHubRepoOwner[]>([]);
const githubOwnersLoading = ref(false);
const githubOwnersError = ref<string | null>(null);
const createGroupBusy = ref(false);
const collapsedGroupIds = ref<Set<string>>(new Set());
const editingGroupId = ref<string | null>(null);
const editingGroupName = ref("");
const editingGroupError = ref<string | null>(null);
const renameGroupBusy = ref(false);
const pendingDeleteGroupId = ref<string | null>(null);
const favoritePendingKeys = ref<Set<string>>(new Set());
const favoriteError = ref<string | null>(null);
const UNGROUPED_REPO_GROUP_ID = "__ungrouped__";
const SIDEBAR_LIST_RENDER_PAGE_SIZE = 80;
const SIDEBAR_REPO_SORT_STORAGE_KEY = "lilia-github.sidebar.repoSort.v1";
const remoteRepoVisibleCount = ref(SIDEBAR_LIST_RENDER_PAGE_SIZE);
const sectionVisibleCounts = ref<Record<string, number>>({});

type SidebarRepoSortKey = "updated" | "name";
type SidebarRepoSortState = RepoSortState<SidebarRepoSortKey>;
const sidebarRepoSortOptions: readonly (RepoSortOption<SidebarRepoSortKey> & { icon: Component })[] = [
  { value: "name", label: "首字母", defaultDirection: "asc", icon: ArrowDownAZ },
  { value: "updated", label: "最近更新", defaultDirection: "desc", icon: Clock },
] as const;
const defaultSidebarRepoSortOption = sidebarRepoSortOptions[1]!;
type SidebarRepoSortOption = (typeof sidebarRepoSortOptions)[number];
const sidebarRepoSort = ref<SidebarRepoSortState>(
  readRepoSort(SIDEBAR_REPO_SORT_STORAGE_KEY, sidebarRepoSortOptions, DEFAULT_REPO_SORT),
);

const footerStatus = computed(() => {
  if (!workspace.workspaceRoot.value) {
    return {
      to: "/",
      label: "Setup",
      title: "尚未选择工作区。点击进入总览配置。",
      tone: "warn" as const,
      icon: FolderGit2,
    };
  }
  if (!workspace.isAuthorized.value) {
    return {
      to: "/",
      label: "Auth",
      title: "尚未完成 GitHub 授权。点击进入总览配置。",
      tone: "warn" as const,
      icon: GitPullRequestArrow,
    };
  }
  return {
    to: "/settings",
    label: workspace.githubBinding.value?.login ?? "GitHub",
    title: "GitHub 已授权。点击进入设置。",
    tone: "ok" as const,
    icon: GitPullRequestArrow,
  };
});
const githubOrganizationVisibilityLimited = computed(() =>
  githubOrganizationAccessLimited(workspace.githubBinding.value?.scopes, githubOwners.value),
);
const githubOrganizationRecovery = computed(() => githubOrganizationAccessRecovery(githubOwners.value));
const githubOrganizationVisibilityMessage = computed(() => githubOrganizationAccessMessage(githubOwners.value));
const githubOrganizations = computed(() => githubOrganizationOwners(githubOwners.value));

async function loadSidebarGitHubOwners() {
  if (!workspace.isAuthorized.value) return;
  await githubOwnersLoader.run("sidebar-github-owners", async (runId) => {
    githubOwnersLoading.value = true;
    githubOwnersError.value = null;
    try {
      const owners = await listGitHubRepoOwners();
      if (!githubOwnersLoader.isCurrent(runId)) return;
      githubOwners.value = owners;
    } catch (err) {
      if (!githubOwnersLoader.isCurrent(runId)) return;
      githubOwnersError.value = `账号与组织加载失败：${githubUserFacingError(err)}`;
    } finally {
      if (githubOwnersLoader.isCurrent(runId)) githubOwnersLoading.value = false;
    }
  });
}

async function openSidebarOrganizationAuthorization(recoveryUrl: string | null = null) {
  const url = recoveryUrl ?? githubOrganizationRecovery.value.url;
  if (url) {
    await workspace.openUrl(url);
    return;
  }
  await router.push({ path: "/settings", query: { tab: "account" } });
}

watch(
  () => [
    workspace.isAuthorized.value,
    workspace.githubBinding.value?.login,
    workspace.githubBinding.value?.boundAt,
    [...(workspace.githubBinding.value?.scopes ?? [])].sort().join(" "),
  ] as const,
  ([authorized]) => {
    githubOwnersLoader.invalidate();
    githubOwners.value = [];
    githubOwnersError.value = null;
    githubOwnersLoading.value = false;
    if (authorized) void loadSidebarGitHubOwners();
  },
  { immediate: true },
);

onUnmounted(() => {
  githubOwnersLoader.invalidate();
});

function repoDirtyCount(repo: { stagedCount: number; unstagedCount: number; untrackedCount: number }) {
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}

const bulkSyncRunningRepoIds = computed(() => {
  return getBulkSyncRunningRepoIds();
});
const refreshingRepoIds = computed(() => new Set(
  workspace.state.tasks
    .filter((task) => task.kind === "repoStatus" && (task.status === "pending" || task.status === "running"))
    .flatMap((task) => task.repoId ? [task.repoId] : []),
));
const syncIssueByRepoId = computed(() => repoSyncIssuesByRepoId());

type RepoIssue = RepoSyncIssueDisplay;
const CONFLICT_REPO_ISSUE: RepoIssue = {
  label: "存在合并冲突",
  message: "存在合并冲突，请处理后再同步",
  retryable: false,
  retrying: false,
  updatedAt: 0,
};

interface RepoItem {
  id: string;
  name: string;
  title: string;
  to: string;
  href: string;
  githubFullName: string | null;
  icon: Component;
  iconClass: string;
  dirtyCount: number;
  ahead: number;
  behind: number;
  conflictCount: number;
  lastCommitAt: number | null;
  sourceIndex: number;
}

interface RepoGroupRef {
  readonly id: string;
  readonly name: string;
}

interface RepoSection {
  id: string;
  name: string;
  items: RepoItem[];
  visibleItems: RepoItem[];
  hiddenItemCount: number;
  collapsed: boolean;
  group: RepoGroupRef | null;
}

const repoItemCache = new Map<string, RepoItem>();
const repoRouteCache = new Map<string, { to: string; href: string }>();
const repoItemIndexById = new Map<string, number>();

function sameRepoItem(current: RepoItem, next: RepoItem) {
  return current.name === next.name &&
    current.title === next.title &&
    current.to === next.to &&
    current.href === next.href &&
    current.githubFullName === next.githubFullName &&
    current.icon === next.icon &&
    current.iconClass === next.iconClass &&
    current.dirtyCount === next.dirtyCount &&
    current.ahead === next.ahead &&
    current.behind === next.behind &&
    current.conflictCount === next.conflictCount &&
    current.lastCommitAt === next.lastCommitAt &&
    current.sourceIndex === next.sourceIndex;
}

function repoRouteEntry(repoId: string) {
  const current = repoRouteCache.get(repoId);
  if (current) return current;
  const to = repoRoute(repoId);
  const entry = { to, href: router.resolve(to).href };
  repoRouteCache.set(repoId, entry);
  return entry;
}

function repoDisplayIcon(source: RepoDisplaySource) {
  if (source === "worktree") return GitBranch;
  if (source === "remote") return GitPullRequestArrow;
  return FolderGit2;
}

function repoItem(repo: RepoSummary, sourceIndex: number) {
  const display = repoDisplayInfo(repo);
  const routeEntry = repoRouteEntry(repo.id);
  const nextItem: RepoItem = {
    id: repo.id,
    name: display.name,
    title: repoDisplayTitle(repo),
    to: routeEntry.to,
    href: routeEntry.href,
    githubFullName: repo.githubFullName ?? null,
    icon: repoDisplayIcon(display.source),
    iconClass: `is-${display.source}`,
    dirtyCount: repoDirtyCount(repo),
    ahead: repo.ahead,
    behind: repo.behind,
    conflictCount: repo.conflictCount,
    lastCommitAt: repo.lastCommitAt,
    sourceIndex,
  };
  const currentItem = repoItemCache.get(repo.id);
  if (currentItem && sameRepoItem(currentItem, nextItem)) return currentItem;
  repoItemCache.set(repo.id, nextItem);
  return nextItem;
}

function rebuildRepoItems(repos: readonly RepoSummary[]) {
  const activeRepoIds = new Set<string>();
  const items = repos.map((repo, index) => {
    activeRepoIds.add(repo.id);
    repoItemIndexById.set(repo.id, index);
    return repoItem(repo, index);
  });
  for (const repoId of repoItemCache.keys()) {
    if (!activeRepoIds.has(repoId)) {
      repoItemCache.delete(repoId);
      repoRouteCache.delete(repoId);
      repoItemIndexById.delete(repoId);
    }
  }
  return items;
}

const repoItems = shallowRef<RepoItem[]>(rebuildRepoItems(workspace.state.repos));

watch(
  () => workspace.state.repos,
  () => {
    repoItems.value = rebuildRepoItems(workspace.state.repos);
  },
);

watch(
  () => workspace.state.repoListChange.revision,
  () => {
    const change = workspace.state.repoListChange;
    if (change.structural) {
      repoItems.value = rebuildRepoItems(workspace.state.repos);
      return;
    }
    const nextItems = repoItems.value.slice();
    const repoById = change.changedRepoIds.length > 12
      ? new Map(workspace.state.repos.map((repo) => [repo.id, repo]))
      : null;
    let changed = false;
    for (const repoId of change.changedRepoIds) {
      const index = repoItemIndexById.get(repoId);
      if (index == null) continue;
      const repo = repoById?.get(repoId) ?? workspace.state.repos.find((item) => item.id === repoId);
      if (!repo) continue;
      const nextItem = repoItem(repo, index);
      if (nextItems[index] !== nextItem) {
        nextItems[index] = nextItem;
        changed = true;
      }
    }
    if (changed) repoItems.value = nextItems;
  },
);

const repoGroups = computed(() => workspace.state.settings?.repoGroups ?? []);
const favoriteRepos = computed(() =>
  favoriteRepositories(workspace.state.settings, workspace.state.repos),
);
const repoGroupIds = computed(() => repoGroups.value.map((group) => group.id));

const repoItemById = computed(() => new Map(repoItems.value.map((item) => [item.id, item])));
const repoConflictIssueById = computed(() => {
  const issues = new Map<string, RepoIssue>();
  for (const item of repoItems.value) {
    if (item.conflictCount <= 0) continue;
    issues.set(item.id, CONFLICT_REPO_ISSUE);
  }
  return issues;
});
const repoIssueById = computed(() => {
  const issues = new Map<string, RepoIssue>(syncIssueByRepoId.value);
  for (const [repoId, issue] of repoConflictIssueById.value) {
    if (!issues.has(repoId)) issues.set(repoId, issue);
  }
  return issues;
});

const groupedRepoIds = computed(() => {
  const ids = new Set<string>();
  for (const group of repoGroups.value) {
    for (const repoId of group.repoIds) ids.add(repoId);
  }
  return ids;
});

const ungroupedRepoItems = computed(() =>
  repoItems.value.filter((item) => !groupedRepoIds.value.has(item.id)),
);

const activeSidebarRepoSortOption = computed(() =>
  sidebarRepoSortOptions.find((option) => option.value === sidebarRepoSort.value.sort) ?? defaultSidebarRepoSortOption,
);
const sidebarRepoSortLabel = computed(() =>
  repoSortDisplayLabel(activeSidebarRepoSortOption.value, sidebarRepoSort.value.direction),
);
const sidebarRepoSortIcon = computed(() => activeSidebarRepoSortOption.value.icon);

function sectionVisibleLimit(sectionId: string) {
  return sectionVisibleCounts.value[sectionId] ?? SIDEBAR_LIST_RENDER_PAGE_SIZE;
}

function repoSection(id: string, name: string, items: RepoItem[], group: RepoGroupRef | null): RepoSection {
  const sortedItems = sortedRepoItems(items);
  const visibleItems = sortedItems.slice(0, sectionVisibleLimit(id));
  return {
    id,
    name,
    items: sortedItems,
    visibleItems,
    hiddenItemCount: Math.max(0, sortedItems.length - visibleItems.length),
    collapsed: collapsedGroupIds.value.has(id),
    group,
  };
}

function sortedRepoItems(items: readonly RepoItem[]) {
  return [...items].sort(compareSidebarRepoItems);
}

function compareSidebarRepoItems(left: RepoItem, right: RepoItem) {
  return compareRepoSortItems(left, right, sidebarRepoSort.value, {
    name: (item) => item.name,
    updatedAt: (item) => item.lastCommitAt,
    index: (item) => item.sourceIndex,
  });
}

const localRepoSections = computed<RepoSection[]>(() => [
  repoSection(UNGROUPED_REPO_GROUP_ID, "未分组仓库", ungroupedRepoItems.value, null),
  ...repoGroups.value.map((group) =>
    repoSection(
      group.id,
      group.name,
      group.repoIds
        .map((repoId) => repoItemById.value.get(repoId))
        .filter((item): item is RepoItem => Boolean(item)),
      group,
    )
  ),
]);

watch(
  repoGroupIds,
  (ids) => {
    const groupIds = new Set([UNGROUPED_REPO_GROUP_ID, ...ids]);
    collapsedGroupIds.value = new Set([...collapsedGroupIds.value].filter((id) => groupIds.has(id)));
    sectionVisibleCounts.value = Object.fromEntries(
      Object.entries(sectionVisibleCounts.value).filter(([id]) => groupIds.has(id)),
    );
    if (editingGroupId.value && !groupIds.has(editingGroupId.value)) {
      editingGroupId.value = null;
      editingGroupName.value = "";
      editingGroupError.value = null;
    }
  },
);

const localRepoFullNames = computed(() =>
  new Set(
    repoItems.value
      .map((repo) => repo.githubFullName)
      .filter((name): name is string => Boolean(name))
      .map(githubRepositoryIdentityKey),
  ),
);

const remoteRepoItems = computed(() =>
  [...(workspace.state.settings?.remoteRepoShortcuts ?? [])]
    .filter((repo) => {
      const accountLogin = workspace.githubBinding.value?.login;
      return !accountLogin || repo.accountLogin?.toLocaleLowerCase() === accountLogin.toLocaleLowerCase();
    })
    .filter((repo) => !localRepoFullNames.value.has(githubRepositoryIdentityKey(repo.fullName)))
    .sort((a, b) => b.openedAt - a.openedAt || a.fullName.localeCompare(b.fullName)),
);
const visibleRemoteRepoItems = computed(() =>
  remoteRepoItems.value.slice(0, remoteRepoVisibleCount.value),
);
const hiddenRemoteRepoItemCount = computed(() =>
  Math.max(0, remoteRepoItems.value.length - visibleRemoteRepoItems.value.length),
);

const activeRemoteFullName = computed(() =>
  parseRemoteRepoId(String(route.params.repoId ?? "")),
);
const activeRepoId = computed(() => {
  if (!route.path.startsWith("/repos/")) return null;
  const repoId = String(route.params.repoId ?? "");
  return parseRemoteRepoId(repoId) ? null : repoId;
});
const launchRunningRepoIds = computed(() =>
  new Set(
    Object.entries(workspace.state.launchStatuses)
      .filter(([, status]) => status?.state === "running")
      .map(([repoId]) => repoId),
  ),
);

function showMoreRepoSection(sectionId: string) {
  sectionVisibleCounts.value = {
    ...sectionVisibleCounts.value,
    [sectionId]: sectionVisibleLimit(sectionId) + SIDEBAR_LIST_RENDER_PAGE_SIZE,
  };
}

function showMoreRemoteRepos() {
  remoteRepoVisibleCount.value += SIDEBAR_LIST_RENDER_PAGE_SIZE;
}

async function openRemoteRepo(fullName: string) {
  await router.push(remoteRepoRoute(fullName));
}

async function removeRemoteRepo(fullName: string) {
  await workspace.forgetRemoteRepo(fullName);
  if (activeRemoteFullName.value === fullName) {
    await router.push("/");
  }
}

function repoCurrentGroupId(repoId: string): string | null {
  return repoGroups.value.find((group) => group.repoIds.includes(repoId))?.id ?? null;
}

function localRepoFavorite(repoId: string) {
  return workspace.state.settings?.favoriteRepoIds.includes(repoId) ?? false;
}

function favoritePending(key: string) {
  return favoritePendingKeys.value.has(key);
}

async function runFavoriteMutation(key: string, mutation: () => Promise<unknown>) {
  if (favoritePending(key)) return;
  favoriteError.value = null;
  favoritePendingKeys.value = new Set(favoritePendingKeys.value).add(key);
  try {
    await mutation();
  } catch (err) {
    favoriteError.value = `收藏更新失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    const next = new Set(favoritePendingKeys.value);
    next.delete(key);
    favoritePendingKeys.value = next;
  }
}

async function toggleLocalRepoFavorite(repoId: string) {
  const repo = workspace.state.repos.find((item) => item.id === repoId);
  if (!repo) return;
  const key = repo.githubFullName
    ? `github:${githubRepositoryIdentityKey(repo.githubFullName)}`
    : `local:${repo.id}`;
  await runFavoriteMutation(key, () =>
    workspace.setLocalRepoFavorite(repoId, !localRepoFavorite(repoId)),
  );
}

async function removeSidebarFavorite(favorite: FavoriteRepositoryEntry) {
  await runFavoriteMutation(favorite.key, async () => {
    if (favorite.localFavorite && favorite.localRepo) {
      await workspace.setLocalRepoFavorite(favorite.localRepo.id, false);
    }
    if (favorite.remoteFavorite && favorite.remoteShortcut) {
      await workspace.setRemoteRepoFavorite({ ...favorite.remoteShortcut }, false);
    }
  });
}

async function openSidebarFavorite(favorite: FavoriteRepositoryEntry) {
  if (favorite.localRepo) {
    await router.push(repoRoute(favorite.localRepo.id));
    return;
  }
  if (favorite.remoteShortcut) {
    await router.push(remoteRepoRoute(favorite.remoteShortcut.fullName));
  }
}

const sidebarRepoContextMenuProvider: ContextMenuProvider = (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest<HTMLElement>("[data-sidebar-repo-id]");
  const repoId = row?.dataset.sidebarRepoId;
  return repoId ? repoContextMenu(repoId) : [];
};

function repoContextMenu(repoId: string): ContextMenuItem[] {
  const currentGroupId = repoCurrentGroupId(repoId);
  const moveChildren: ContextMenuItem[] = [
    {
      id: `move-repo-${repoId}-ungrouped`,
      label: "移到未分组",
      icon: FolderGit2,
      disabled: currentGroupId === null,
      async onSelect() {
        await workspace.moveRepoToGroup(repoId, null);
      },
    },
    ...repoGroups.value.map((group) => ({
      id: `move-repo-${repoId}-${group.id}`,
      label: group.name,
      icon: FolderInput,
      disabled: currentGroupId === group.id,
      async onSelect() {
        await workspace.moveRepoToGroup(repoId, group.id);
      },
    })),
  ];
  return [
    {
      id: `favorite-repo-${repoId}`,
      label: localRepoFavorite(repoId) ? "取消收藏" : "收藏仓库",
      icon: Star,
      async onSelect() {
        await toggleLocalRepoFavorite(repoId);
      },
    },
    {
      id: `move-repo-${repoId}`,
      label: "移动到分组",
      icon: FolderInput,
      children: moveChildren,
    },
    {
      id: `hide-repo-${repoId}`,
      label: "隐藏仓库",
      icon: EyeOff,
      danger: true,
      confirmLabel: "确认隐藏？再点一次",
      async onSelect() {
        await workspace.hideRepo(repoId);
        if (route.path.startsWith("/repos/") && String(route.params.repoId ?? "") === repoId) {
          await router.push("/");
        }
      },
    },
  ];
}

async function retryRepoPush(repoId: string) {
  try {
    await workspace.push(repoId);
  } catch {
    /* retry state is kept in recent sync results */
  }
}

function navigateRepo(to: string, event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return;
  }
  event.preventDefault();
  void router.push(to);
}

function focusEditingGroupInput(groupId: string) {
  void nextTick(() => {
    const input = Array.from(document.querySelectorAll<HTMLInputElement>("[data-repo-group-name-input]"))
      .find((element) => element.dataset.repoGroupNameInput === groupId);
    input?.focus();
    input?.select();
  });
}

function nextUnnamedGroupName() {
  const baseName = "未命名分组";
  const usedNames = new Set(repoGroups.value.map((group) => group.name.trim().toLocaleLowerCase()));
  if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName;
  for (let index = 2; ; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function startRenameGroup(group: { id: string; name: string }) {
  editingGroupId.value = group.id;
  editingGroupName.value = group.name;
  editingGroupError.value = null;
  focusEditingGroupInput(group.id);
}

async function createGroup() {
  if (createGroupBusy.value) return;
  const beforeGroupIds = new Set(repoGroups.value.map((group) => group.id));
  createGroupBusy.value = true;
  try {
    const settings = await workspace.createRepoGroup(nextUnnamedGroupName());
    const groups = settings.repoGroups;
    const createdGroup = groups.find((group) => !beforeGroupIds.has(group.id)) ?? groups[groups.length - 1];
    collapsedGroupIds.value = new Set([UNGROUPED_REPO_GROUP_ID, ...groups.map((group) => group.id)]);
    if (createdGroup) startRenameGroup(createdGroup);
  } catch (err) {
    editingGroupError.value = err instanceof Error ? err.message : String(err);
  } finally {
    createGroupBusy.value = false;
  }
}

function toggleGroupCollapsed(groupId: string, event?: MouseEvent) {
  const next = new Set(collapsedGroupIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedGroupIds.value = next;
  if (event?.detail) {
    (event.currentTarget as HTMLElement | null)?.blur();
  }
}

function sectionToggleLabel(section: RepoSection) {
  return `${section.collapsed ? "展开" : "折叠"}分组 ${section.name}`;
}

function selectSidebarRepoSort(option: SidebarRepoSortOption) {
  sidebarRepoSort.value = nextRepoSort(sidebarRepoSort.value, option);
  writeRepoSort(SIDEBAR_REPO_SORT_STORAGE_KEY, sidebarRepoSort.value);
}

function openSidebarRepoSortMenu(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement | null;
  const rect = button?.getBoundingClientRect();
  openContextMenuAt(
    rect?.left ?? event.clientX,
    (rect?.bottom ?? event.clientY) + 4,
    sidebarRepoSortOptions.map((option) => ({
      id: `sidebar.group.sort.${option.value}`,
      label: nextRepoSortDisplayLabel(sidebarRepoSort.value, option),
      icon: option.icon,
      onSelect: () => selectSidebarRepoSort(option),
    })),
  );
}

async function finishRenameGroup(group: { id: string; name: string }) {
  if (renameGroupBusy.value) return;
  const name = editingGroupName.value.trim();
  editingGroupError.value = null;
  if (!name || name === group.name) {
    editingGroupId.value = null;
    editingGroupName.value = "";
    return;
  }
  renameGroupBusy.value = true;
  try {
    await workspace.renameRepoGroup(group.id, name);
    editingGroupId.value = null;
    editingGroupName.value = "";
  } catch (err) {
    editingGroupError.value = err instanceof Error ? err.message : String(err);
    focusEditingGroupInput(group.id);
  } finally {
    renameGroupBusy.value = false;
  }
}

function cancelRenameGroup() {
  editingGroupId.value = null;
  editingGroupName.value = "";
  editingGroupError.value = null;
}

async function deleteGroup(group: { id: string }) {
  if (pendingDeleteGroupId.value !== group.id) {
    pendingDeleteGroupId.value = group.id;
    return;
  }
  await workspace.deleteRepoGroup(group.id);
  if (editingGroupId.value === group.id) cancelRenameGroup();
  const nextCollapsed = new Set(collapsedGroupIds.value);
  nextCollapsed.delete(group.id);
  collapsedGroupIds.value = nextCollapsed;
  pendingDeleteGroupId.value = null;
}
</script>

<template>
  <aside class="secondary-panel" data-agent-id="sidebar">
    <div class="secondary-panel__top">
      <div class="sb-section">
        <div class="sb-section__header">
          <span class="sb-section__title">工作区</span>
        </div>
        <nav class="sb-tree" aria-label="主导航">
          <RouterLink
            v-for="item in SIDEBAR_NAV"
            :key="item.label"
            :to="item.to ?? '/'"
            class="sb-tree__row"
            :data-agent-id="`sidebar.nav.${item.label}`"
            exact-active-class="is-active"
            :aria-disabled="item.disabled ? 'true' : undefined"
          >
            <component :is="item.icon" :size="14" aria-hidden="true" />
            <span class="sb-tree__name">{{ item.label }}</span>
            <SidebarRowTools v-if="item.tools?.length" :tools="item.tools" />
          </RouterLink>
          <template v-if="workspace.githubBinding.value">
            <RouterLink
              to="/profile"
              class="sb-tree__row"
              data-agent-id="sidebar.profile"
              exact-active-class="is-active"
            >
              <img
                v-if="workspace.githubBinding.value.avatarUrl"
                :src="workspace.githubBinding.value.avatarUrl"
                alt=""
                class="sb-tree__avatar"
              />
              <UserRound v-else :size="14" aria-hidden="true" />
              <span class="sb-tree__name">{{ workspace.githubBinding.value.login }}</span>
            </RouterLink>
            <RouterLink
              v-for="organization in githubOrganizations"
              :key="organization.login"
              :to="{ name: 'github-organization', params: { login: organization.login } }"
              class="sb-tree__row"
              active-class="is-active"
              :data-agent-id="`sidebar.organization.${organization.login}`"
            >
              <img
                v-if="organization.avatarUrl"
                :src="organization.avatarUrl"
                alt=""
                class="sb-tree__avatar"
              />
              <Building2 v-else :size="14" aria-hidden="true" />
              <span class="sb-tree__name">{{ organization.login }}</span>
              <span v-if="organization.source === 'repository_access'" class="sb-tree__meta">仓库访问</span>
            </RouterLink>
            <GitHubRepositoryStateNotice
              v-if="githubOwnersLoading && !githubOrganizations.length"
              state="loading"
              compact
              message="正在加载组织…"
              agent-id="sidebar.organizations.loading"
            />
            <GitHubRepositoryStateNotice
              v-else-if="githubOwnersError"
              state="error"
              compact
              retryable
              :message="githubOwnersError"
              agent-id="sidebar.organizations.error"
              @retry="loadSidebarGitHubOwners"
            />
            <GitHubRepositoryStateNotice
              v-if="githubOrganizationVisibilityLimited"
              state="limited"
              compact
              :message="githubOrganizationVisibilityMessage"
              :action-label="githubOrganizationRecovery.url ? '在 GitHub 授权' : '补充组织权限'"
              agent-id="sidebar.organizations.limited"
              @authorize="openSidebarOrganizationAuthorization(githubOrganizationRecovery.url)"
            />
          </template>
        </nav>
      </div>
    </div>

    <div
      class="secondary-panel__body"
      v-context-menu="sidebarRepoContextMenuProvider"
    >
      <div class="sb-section sb-section--favorites">
        <div class="sb-section__header">
          <span class="sb-section__title">收藏仓库 {{ favoriteRepos.length }}</span>
        </div>
        <div class="sb-tree">
          <div
            v-for="favorite in favoriteRepos"
            :key="favorite.key"
            class="sb-tree__row sb-tree__row--project sb-tree__row--favorite"
            :class="{
              'is-active': favorite.localRepo
                ? activeRepoId === favorite.localRepo.id
                : activeRemoteFullName === favorite.remoteShortcut?.fullName,
            }"
            role="link"
            tabindex="0"
            :data-agent-id="`sidebar.favorite.${favorite.key}.open`"
            :aria-label="`打开收藏 ${favorite.name}`"
            :title="favorite.title"
            @click="openSidebarFavorite(favorite)"
            @keydown.enter.prevent="openSidebarFavorite(favorite)"
            @keydown.space.prevent="openSidebarFavorite(favorite)"
          >
            <Star :size="13" aria-hidden="true" class="sb-tree__favorite-icon" />
            <span class="sb-tree__name">{{ favorite.name }}</span>
            <span class="sb-tree__favorite-kind">{{ favorite.localRepo ? "本地" : "远程" }}</span>
            <button
              type="button"
              class="sb-icon-btn sb-tree__favorite-remove"
              :data-agent-id="`sidebar.favorite.${favorite.key}.remove`"
              :aria-label="`取消收藏 ${favorite.name}`"
              title="取消收藏"
              :disabled="favoritePending(favorite.key)"
              @click.stop="removeSidebarFavorite(favorite)"
            >
              <LoaderCircle v-if="favoritePending(favorite.key)" :size="12" aria-hidden="true" class="sb-spin" />
              <X v-else :size="12" aria-hidden="true" />
            </button>
          </div>
          <p v-if="!favoriteRepos.length" class="sb-tree__empty">右键本地仓库或在首页收藏。</p>
          <p v-if="favoriteError" class="sb-tree__empty sb-tree__empty--error">{{ favoriteError }}</p>
        </div>
      </div>

      <div
        v-for="section in localRepoSections"
        :key="section.id"
        class="sb-section sb-section--group"
      >
        <div class="sb-section__header">
          <button
            v-if="editingGroupId !== section.id"
            type="button"
            class="sb-group-toggle"
            :data-agent-id="`sidebar.group.${section.id}.toggle`"
            :aria-label="sectionToggleLabel(section)"
            :aria-expanded="!section.collapsed"
            @click="toggleGroupCollapsed(section.id, $event)"
          >
            <span class="sb-section__title">{{ section.name }}</span>
            <span class="sb-group-count">{{ section.items.length }}</span>
            <ChevronRight
              :size="13"
              aria-hidden="true"
              class="sb-group-toggle__chevron"
              :class="{ 'is-open': !section.collapsed }"
            />
          </button>
          <div v-else class="sb-group-toggle sb-group-edit">
            <input
              v-model="editingGroupName"
              type="text"
              :data-agent-id="`sidebar.group.${section.id}.name`"
              aria-label="重命名分组"
              :data-repo-group-name-input="section.id"
              :disabled="renameGroupBusy"
              @blur="section.group ? finishRenameGroup(section.group) : cancelRenameGroup()"
              @keydown.enter.prevent="section.group ? finishRenameGroup(section.group) : cancelRenameGroup()"
              @keydown.esc.prevent="cancelRenameGroup"
            />
            <p v-if="editingGroupError" class="sb-group-edit__error">{{ editingGroupError }}</p>
          </div>
          <template v-if="section.group">
            <button
              type="button"
              class="sb-icon-btn sb-section__hover-action"
              :data-agent-id="`sidebar.group.${section.id}.rename`"
              :aria-label="`重命名分组 ${section.name}`"
              title="重命名分组"
              @click="startRenameGroup(section.group)"
            >
              <Pencil :size="13" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="sb-icon-btn sb-section__hover-action"
              :data-agent-id="`sidebar.group.${section.id}.delete`"
              :class="{ 'is-danger': pendingDeleteGroupId === section.id }"
              :aria-label="pendingDeleteGroupId === section.id ? `确认删除分组 ${section.name}` : `删除分组 ${section.name}`"
              :title="pendingDeleteGroupId === section.id ? '确认删除分组' : '删除分组'"
              @click="deleteGroup(section.group)"
            >
              <Trash2 :size="13" aria-hidden="true" />
            </button>
          </template>
          <button
            v-if="editingGroupId !== section.id && section.id === UNGROUPED_REPO_GROUP_ID"
            type="button"
            class="sb-icon-btn sb-section__hover-action"
            data-agent-id="sidebar.group.sort"
            :aria-label="`侧边栏仓库排序：${sidebarRepoSortLabel}`"
            :title="`排序：${sidebarRepoSortLabel}`"
            @click="openSidebarRepoSortMenu"
          >
            <component :is="sidebarRepoSortIcon" :size="13" aria-hidden="true" />
          </button>
          <button
            v-if="!section.group"
            type="button"
            class="sb-icon-btn sb-section__hover-action"
            data-agent-id="sidebar.group.create"
            aria-label="创建仓库分组"
            title="创建仓库分组"
            :disabled="createGroupBusy"
            @click="createGroup"
          >
            <Plus :size="13" aria-hidden="true" />
          </button>
        </div>
        <SidebarCollapse :open="!section.collapsed">
          <div class="sb-tree">
            <RepoSidebarRow
              v-for="item in section.visibleItems"
              :key="item.id"
              :id="item.id"
              :name="item.name"
              :title="item.title"
              :href="item.href"
              :icon="item.icon"
              :icon-class="item.iconClass"
              :active="activeRepoId === item.id"
              :dirty-count="item.dirtyCount"
              :ahead="item.ahead"
              :behind="item.behind"
              :issue="repoIssueById.get(item.id) ?? null"
              :syncing="bulkSyncRunningRepoIds.has(item.id)"
              :refreshing="refreshingRepoIds.has(item.id)"
              :launch-running="launchRunningRepoIds.has(item.id)"
              @navigate="navigateRepo(item.to, $event)"
              @retry="retryRepoPush(item.id)"
            />
            <button
              v-if="section.hiddenItemCount > 0"
              type="button"
              class="sb-tree__more"
              :data-agent-id="`sidebar.group.${section.id}.show-more`"
              @click="showMoreRepoSection(section.id)"
            >
              显示更多 {{ section.hiddenItemCount }} 个
            </button>
            <p v-if="!workspace.state.repos.length" class="sb-tree__empty">选择工作区后显示 Git 仓库。</p>
            <p v-else-if="!section.items.length" class="sb-tree__empty">没有仓库。</p>
          </div>
        </SidebarCollapse>
      </div>

      <div v-if="remoteRepoItems.length" class="sb-section sb-section--remote">
        <div class="sb-section__header">
          <span class="sb-section__title">远程仓库 {{ remoteRepoItems.length }}</span>
        </div>
        <div class="sb-tree">
          <div
            v-for="repo in visibleRemoteRepoItems"
            :key="repo.fullName"
            class="sb-tree__row sb-tree__row--project sb-tree__row--remote"
            :class="{ 'is-active': activeRemoteFullName === repo.fullName }"
            role="link"
            tabindex="0"
            :data-agent-id="`sidebar.remote.${repo.fullName}`"
            :title="repo.fullName"
            :aria-label="`打开 ${repo.fullName}`"
            @click="openRemoteRepo(repo.fullName)"
            @keydown.enter.prevent="openRemoteRepo(repo.fullName)"
            @keydown.space.prevent="openRemoteRepo(repo.fullName)"
          >
            <GitPullRequestArrow :size="14" aria-hidden="true" class="sb-tree__repo-icon is-remote" />
            <span class="sb-tree__name">{{ repo.name }}</span>
            <span v-if="repo.archived" class="sb-badge">ARCH</span>
            <span v-if="repo.private" class="sb-badge">私有</span>
            <button
              type="button"
              class="sb-icon-btn sb-tree__remote-remove"
              :data-agent-id="`sidebar.remote.${repo.fullName}.remove`"
              :aria-label="`移除 ${repo.fullName}`"
              title="从侧边栏移除"
              @click.stop="removeRemoteRepo(repo.fullName)"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </div>
          <button
            v-if="hiddenRemoteRepoItemCount > 0"
            type="button"
            class="sb-tree__more"
            data-agent-id="sidebar.remote.show-more"
            @click="showMoreRemoteRepos"
          >
            显示更多 {{ hiddenRemoteRepoItemCount }} 个
          </button>
        </div>
      </div>
    </div>

    <div class="secondary-panel__footer">
      <SidebarFooter
        :status="footerStatus"
      />
    </div>
  </aside>
</template>

<style scoped>
.secondary-panel__top,
.secondary-panel__footer {
  flex: 0 0 auto;
  min-width: 0;
}

.secondary-panel__body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.secondary-panel__body > .sb-section + .sb-section {
  margin-top: 14px;
}

.sb-section {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.sb-section__header {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px 0 8px;
  color: var(--text-faint);
}

.sb-section__hover-action {
  opacity: 0;
  pointer-events: none;
}

.sb-section__header:hover .sb-section__hover-action,
.sb-section__header:focus-within .sb-section__hover-action {
  opacity: 1;
  pointer-events: auto;
}

.sb-section__title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-tree__row--favorite {
  cursor: pointer;
}

.sb-tree__avatar {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border-radius: 5px;
  object-fit: cover;
}

.sb-tree__meta {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 10px;
}

.sb-tree__favorite-icon {
  flex: 0 0 auto;
  fill: var(--warn);
  color: var(--warn);
}

.sb-tree__favorite-kind {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 10px;
}

.sb-tree__favorite-remove {
  flex: 0 0 auto;
  opacity: 0;
  pointer-events: none;
}

.sb-tree__empty--error {
  color: var(--err);
}

.sb-tree__row--favorite:hover .sb-tree__favorite-remove,
.sb-tree__row--favorite:focus-within .sb-tree__favorite-remove {
  opacity: 1;
  pointer-events: auto;
}

.sb-row-loader {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.sb-icon-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.sb-icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--radius-sm);
}

.sb-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.sb-icon-btn.is-danger {
  color: var(--err);
  background: var(--err-soft);
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

.sb-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
}

.sb-tree__empty {
  margin: 6px 8px;
  color: var(--text-faint);
  font-size: 12px;
}

.sb-tree__more {
  width: 100%;
  min-height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sb-tree__more:hover,
.sb-tree__more:focus-visible {
  background: var(--bg-subtle);
  color: var(--text);
}

.sb-tree__row:hover .sb-tree__hover-tools,
.sb-tree__row:focus-within .sb-tree__hover-tools,
.sb-tree__row.is-active .sb-tree__hover-tools {
  opacity: 1;
  pointer-events: auto;
}

.sb-group-toggle {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  cursor: pointer;
  text-align: left;
}

.sb-group-toggle:hover {
  color: var(--text-muted);
}

.sb-group-toggle .sb-section__title {
  flex: 0 1 auto;
  text-align: left;
}

.sb-group-count {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
}

.sb-group-toggle__chevron {
  flex: 0 0 auto;
  transition: transform 0.12s ease;
}

.sb-group-toggle__chevron.is-open {
  transform: rotate(90deg);
}

.sb-group-edit {
  position: relative;
  cursor: text;
}

.sb-group-edit input {
  flex: 1 1 auto;
  min-width: 0;
  height: 22px;
  margin-left: -3px;
  padding: 0 4px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  line-height: 20px;
}

.sb-group-edit__error {
  position: absolute;
  top: 24px;
  left: 0;
  z-index: 2;
  margin: 0;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  color: var(--err);
  font-size: 12px;
  white-space: nowrap;
}

.sb-tree__row--remote {
  cursor: pointer;
}

.sb-tree__remote-remove {
  flex: 0 0 auto;
  opacity: 0;
  pointer-events: none;
}

.sb-tree__row--remote:hover .sb-tree__remote-remove,
.sb-tree__row--remote:focus-within .sb-tree__remote-remove,
.sb-tree__row--remote.is-active .sb-tree__remote-remove {
  opacity: 1;
  pointer-events: auto;
}

.sb-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
}

.sb-badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}

.sb-badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}

.sb-badge--error {
  background: var(--err-soft);
  color: var(--err);
}

@keyframes sb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
