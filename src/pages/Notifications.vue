<script setup lang="ts">
import {
  Bell,
  CheckCheck,
  LoaderCircle,
  RefreshCw,
  X,
} from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useComponentEpoch } from "../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../composables/useLatestAsyncLoader";
import { useWorkspace } from "../composables/useWorkspace";
import {
  listGitHubNotifications,
  markGitHubNotificationsRead,
  unsubscribeGitHubNotification,
  type GitHubNotification,
  type GitHubNotificationCategory,
} from "../services/notifications";
import {
  githubErrorCode,
  isGitHubBindingExpiredError,
  isGitHubPermissionError,
} from "../services/workspace/client";
import {
  notificationCategory,
  notificationCategoryLabel,
  notificationTarget,
} from "../utils/notifications";

const PAGE_SIZE = 50;
const categories: GitHubNotificationCategory[] = [
  "issue",
  "pull_request",
  "review",
  "discussion",
  "actions",
  "other",
];

const router = useRouter();
const workspace = useWorkspace();
const items = ref<GitHubNotification[]>([]);
const page = ref(1);
const hasNextPage = ref(false);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const showAll = ref(false);
const repoFilter = ref("");
const categoryFilter = ref<GitHubNotificationCategory | "">("");
const selectedIds = ref(new Set<string>());
const pendingIds = ref(new Set<string>());
const openingIds = ref(new Set<string>());
const locallyReadIds = new Set<string>();
const unsubscribedIds = new Set<string>();
const componentEpoch = useComponentEpoch();
const firstPageLoader = createLatestAsyncLoader({ componentEpoch });
const moreLoader = createLatestAsyncLoader({ componentEpoch });
const errorCause = ref<unknown>(null);

const repositoryOptions = computed(() =>
  [...new Set(items.value.map((item) => item.repoFullName))].sort((left, right) => left.localeCompare(right)),
);
const filteredItems = computed(() => items.value.filter((item) => {
  if (!showAll.value && !item.unread) return false;
  if (repoFilter.value && item.repoFullName !== repoFilter.value) return false;
  return !categoryFilter.value || notificationCategory(item) === categoryFilter.value;
}));
const visibleUnreadIds = computed(() => filteredItems.value.filter((item) => item.unread).map((item) => item.id));
const selectedUnreadIds = computed(() => visibleUnreadIds.value.filter((id) => selectedIds.value.has(id)));
const allVisibleUnreadSelected = computed(() =>
  visibleUnreadIds.value.length > 0 && visibleUnreadIds.value.every((id) => selectedIds.value.has(id)),
);
const busy = computed(() => loading.value || loadingMore.value || pendingIds.value.size > 0);
const needsRebind = computed(() => errorCause.value !== null && (
  isGitHubBindingExpiredError(errorCause.value) || isGitHubPermissionError(errorCause.value)
));

onMounted(() => void loadFirstPage());

watch(showAll, () => {
  firstPageLoader.invalidate();
  moreLoader.invalidate();
  loadingMore.value = false;
  repoFilter.value = "";
  categoryFilter.value = "";
  selectedIds.value = new Set();
  void loadFirstPage();
});

async function loadFirstPage() {
  await loadPageOne(false);
}

async function refresh() {
  if (loading.value) return;
  await loadPageOne(true);
}

async function loadPageOne(merge: boolean) {
  const all = showAll.value;
  const replacePagination = !merge || page.value === 1;
  moreLoader.invalidate();
  loadingMore.value = false;
  await firstPageLoader.run(`${all}:page-1`, async (runId) => {
    loading.value = true;
    clearError();
    notice.value = null;
    try {
      const result = await listGitHubNotifications({ all, page: 1, perPage: PAGE_SIZE, forceRefresh: true });
      if (!firstPageLoader.isCurrent(runId) || all !== showAll.value) return;
      const incoming = normalizeIncoming(result.items);
      items.value = merge ? mergeNotifications(incoming, items.value) : incoming;
      if (!merge) page.value = result.page;
      if (replacePagination) hasNextPage.value = result.hasNextPage;
    } catch (cause) {
      if (firstPageLoader.isCurrent(runId)) {
        setError(notificationError(cause, merge ? "刷新通知失败，请重试。" : "读取通知失败，请重试。"), cause);
      }
    } finally {
      if (firstPageLoader.isCurrent(runId)) loading.value = false;
    }
  });
}

async function loadMore() {
  if (!hasNextPage.value) return;
  const all = showAll.value;
  const nextPage = page.value + 1;
  await moreLoader.run(`${all}:${nextPage}`, async (runId) => {
    loadingMore.value = true;
    clearError();
    try {
      const result = await listGitHubNotifications({ all, page: nextPage, perPage: PAGE_SIZE });
      if (!moreLoader.isCurrent(runId) || all !== showAll.value || nextPage !== page.value + 1) return;
      items.value = mergeNotifications(items.value, normalizeIncoming(result.items));
      page.value = result.page;
      hasNextPage.value = result.hasNextPage;
    } catch (cause) {
      if (moreLoader.isCurrent(runId)) setError(notificationError(cause, "加载更多通知失败，请重试。"), cause);
    } finally {
      if (moreLoader.isCurrent(runId)) loadingMore.value = false;
    }
  }, { reusePending: true });
}

async function markRead(notificationIds: readonly string[]) {
  const ids = [...new Set(notificationIds)].filter((id) => !pendingIds.value.has(id));
  if (!ids.length) return;
  setPending(ids, true);
  clearError();
  notice.value = null;
  try {
    const result = await markGitHubNotificationsRead(ids);
    for (const id of result.succeededIds) locallyReadIds.add(id);
    const succeeded = new Set(result.succeededIds);
    items.value = items.value.map((item) => succeeded.has(item.id) ? { ...item, unread: false } : item);
    selectedIds.value = new Set([...selectedIds.value].filter((id) => !succeeded.has(id)));
    if (result.failures.length) {
      setError(`${result.failures.length} 条通知未能标记为已读，请重试。`);
    } else {
      notice.value = result.succeededIds.length > 1
        ? `已将 ${result.succeededIds.length} 条通知标记为已读。`
        : "已标记为已读。";
    }
  } catch (cause) {
    setError(notificationError(cause, "标记已读失败，请重试。"), cause);
  } finally {
    setPending(ids, false);
  }
}

async function unsubscribe(notification: GitHubNotification) {
  if (pendingIds.value.has(notification.id)) return;
  setPending([notification.id], true);
  clearError();
  notice.value = null;
  try {
    await unsubscribeGitHubNotification(notification.id);
    unsubscribedIds.add(notification.id);
    items.value = items.value.filter((item) => item.id !== notification.id);
    selectedIds.value = new Set([...selectedIds.value].filter((id) => id !== notification.id));
    notice.value = "已取消订阅。";
  } catch (cause) {
    setError(notificationError(cause, "取消订阅失败，请重试。"), cause);
  } finally {
    setPending([notification.id], false);
  }
}

async function openNotification(notification: GitHubNotification) {
  if (openingIds.value.has(notification.id)) return;
  setOpening(notification.id, true);
  if (notification.unread) await markRead([notification.id]);
  const target = notificationTarget(notification);
  try {
    if (target.kind === "internal") await router.push(target.to);
    else await workspace.openUrl(target.url);
  } catch {
    setError("无法打开通知关联内容，请重试。");
  } finally {
    setOpening(notification.id, false);
  }
}

function toggleSelected(notificationId: string, checked: boolean) {
  const next = new Set(selectedIds.value);
  if (checked) next.add(notificationId);
  else next.delete(notificationId);
  selectedIds.value = next;
}

function toggleVisibleUnread(checked: boolean) {
  const next = new Set(selectedIds.value);
  for (const id of visibleUnreadIds.value) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  selectedIds.value = next;
}

function setPending(ids: readonly string[], pending: boolean) {
  const next = new Set(pendingIds.value);
  for (const id of ids) pending ? next.add(id) : next.delete(id);
  pendingIds.value = next;
}

function setOpening(id: string, opening: boolean) {
  const next = new Set(openingIds.value);
  opening ? next.add(id) : next.delete(id);
  openingIds.value = next;
}

function normalizeIncoming(incoming: readonly GitHubNotification[]) {
  return incoming
    .filter((item) => !unsubscribedIds.has(item.id))
    .map((item) => locallyReadIds.has(item.id) ? { ...item, unread: false } : item);
}

function mergeNotifications(primary: readonly GitHubNotification[], secondary: readonly GitHubNotification[]) {
  const byId = new Map<string, GitHubNotification>();
  for (const item of [...secondary, ...primary]) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function notificationError(cause: unknown, fallback: string) {
  if (isGitHubBindingExpiredError(cause) || isGitHubPermissionError(cause)) {
    return "通知权限不足，请在设置中重新绑定 GitHub 后重试。";
  }
  const code = githubErrorCode(cause);
  if (code === "github_repository_not_accessible") {
    return "通知已失效，请刷新收件箱后继续。";
  }
  if (code === "github_rate_limited") return "GitHub 请求暂时受限，请稍后重试。";
  return fallback;
}

function clearError() {
  error.value = null;
  errorCause.value = null;
}

function setError(message: string, cause: unknown = null) {
  error.value = message;
  errorCause.value = cause;
}
</script>

<template>
  <section class="notifications-page" data-agent-id="notifications.page">
    <header class="page-header notifications-page__header">
      <div>
        <h1>通知</h1>
        <p>处理仓库协作与工作流更新。</p>
      </div>
      <button
        type="button"
        class="ghost notifications-page__refresh"
        data-agent-id="notifications.refresh"
        :disabled="busy"
        @click="refresh"
      >
        <LoaderCircle v-if="loading" :size="14" class="notifications-page__spin" aria-hidden="true" />
        <RefreshCw v-else :size="14" aria-hidden="true" />
        刷新
      </button>
    </header>

    <div class="notifications-toolbar" aria-label="通知筛选">
      <div class="notifications-segmented" role="group" aria-label="读取状态">
        <button
          type="button"
          :class="{ 'is-active': !showAll }"
          data-agent-id="notifications.filter.unread"
          @click="showAll = false"
        >未读</button>
        <button
          type="button"
          :class="{ 'is-active': showAll }"
          data-agent-id="notifications.filter.all"
          @click="showAll = true"
        >全部</button>
      </div>
      <label>
        <span>仓库</span>
        <select v-model="repoFilter" data-agent-id="notifications.filter.repository">
          <option value="">全部仓库</option>
          <option v-for="repo in repositoryOptions" :key="repo" :value="repo">{{ repo }}</option>
        </select>
      </label>
      <label>
        <span>类型</span>
        <select v-model="categoryFilter" data-agent-id="notifications.filter.category">
          <option value="">全部类型</option>
          <option v-for="category in categories" :key="category" :value="category">
            {{ notificationCategoryLabel(category) }}
          </option>
        </select>
      </label>
    </div>

    <div class="notifications-actions" aria-label="通知批量操作">
      <label class="notifications-actions__select">
        <input
          type="checkbox"
          :checked="allVisibleUnreadSelected"
          :disabled="!visibleUnreadIds.length || busy"
          data-agent-id="notifications.select-visible"
          @change="toggleVisibleUnread(($event.target as HTMLInputElement).checked)"
        />
        选择当前未读
      </label>
      <button
        type="button"
        class="ghost"
        :disabled="!selectedUnreadIds.length || busy"
        data-agent-id="notifications.mark-selected-read"
        @click="markRead(selectedUnreadIds)"
      >
        <CheckCheck :size="14" aria-hidden="true" />
        标记已读<span v-if="selectedUnreadIds.length">（{{ selectedUnreadIds.length }}）</span>
      </button>
      <span class="notifications-actions__count">已加载 {{ items.length }} 条</span>
    </div>

    <div v-if="error" class="notifications-status is-error" role="alert" data-agent-id="notifications.error">
      <span>{{ error }}</span>
      <RouterLink
        v-if="needsRebind"
        :to="{ path: '/settings', query: { tab: 'account' } }"
        data-agent-id="notifications.rebind"
      >账户设置</RouterLink>
    </div>
    <p v-else-if="notice" class="notifications-status is-success" role="status">{{ notice }}</p>

    <div v-if="loading && !items.length" class="notifications-empty" aria-label="正在加载通知">
      <LoaderCircle :size="18" class="notifications-page__spin" aria-hidden="true" />
      正在加载通知
    </div>
    <div v-else-if="!filteredItems.length" class="notifications-empty" data-agent-id="notifications.empty">
      <Bell :size="18" aria-hidden="true" />
      <span>{{ items.length ? "当前筛选条件下没有通知。" : "当前没有通知。" }}</span>
    </div>
    <ol v-else class="notifications-list" aria-label="通知列表">
      <li
        v-for="notification in filteredItems"
        :key="notification.id"
        class="notification-row"
        :class="{ 'is-unread': notification.unread }"
        :data-agent-id="`notifications.row.${notification.id}`"
      >
        <input
          type="checkbox"
          :aria-label="`选择 ${notification.title}`"
          :data-agent-id="`notifications.row.${notification.id}.select`"
          :checked="selectedIds.has(notification.id)"
          :disabled="!notification.unread || pendingIds.has(notification.id)"
          @change="toggleSelected(notification.id, ($event.target as HTMLInputElement).checked)"
        />
        <button
          type="button"
          class="notification-row__content"
          :disabled="openingIds.has(notification.id)"
          :data-agent-id="`notifications.row.${notification.id}.open`"
          @click="openNotification(notification)"
        >
          <span class="notification-row__identity">
            <strong>{{ notification.title }}</strong>
            <span>{{ notification.repoFullName }}</span>
          </span>
          <span class="notification-row__meta">
            <span>{{ notificationCategoryLabel(notificationCategory(notification)) }}</span>
            <time :datetime="notification.updatedAt">{{ formatTime(notification.updatedAt) }}</time>
          </span>
        </button>
        <div class="notification-row__actions">
          <button
            v-if="notification.unread"
            type="button"
            class="ghost"
            :disabled="pendingIds.has(notification.id)"
            :data-agent-id="`notifications.row.${notification.id}.mark-read`"
            @click="markRead([notification.id])"
          >
            <LoaderCircle v-if="pendingIds.has(notification.id)" :size="13" class="notifications-page__spin" aria-hidden="true" />
            <CheckCheck v-else :size="13" aria-hidden="true" />
            已读
          </button>
          <button
            type="button"
            class="ghost notification-row__unsubscribe"
            :disabled="pendingIds.has(notification.id)"
            :data-agent-id="`notifications.row.${notification.id}.unsubscribe`"
            @click="unsubscribe(notification)"
          >
            <X :size="13" aria-hidden="true" />
            取消订阅
          </button>
        </div>
      </li>
    </ol>

    <button
      v-if="hasNextPage"
      type="button"
      class="ghost notifications-more"
      :disabled="loadingMore"
      data-agent-id="notifications.load-more"
      @click="loadMore"
    >
      <LoaderCircle v-if="loadingMore" :size="14" class="notifications-page__spin" aria-hidden="true" />
      {{ loadingMore ? "正在加载" : "加载更多" }}
    </button>
  </section>
</template>

<style scoped>
.notifications-page { display: grid; align-content: start; gap: 12px; width: min(1100px, 100%); margin: 0 auto; }
.notifications-page__header { margin: 0; }
.notifications-page__header h1, .notifications-page__header p { margin: 0; }
.notifications-page__header h1 { font-size: 18px; font-weight: 600; }
.notifications-page__header p { margin-top: 3px; color: var(--text-muted); font-size: 12px; }
.notifications-page__refresh, .notifications-actions button, .notification-row__actions button, .notifications-more { display: inline-flex; align-items: center; gap: 5px; }
.notifications-toolbar, .notifications-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.notifications-toolbar { padding: 10px; border: 1px solid var(--border-soft); border-radius: 8px; background: var(--bg-elev); }
.notifications-toolbar label { display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; }
.notifications-toolbar select { min-height: 30px; max-width: 240px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.notifications-segmented { display: inline-flex; padding: 2px; border-radius: 6px; background: var(--bg-subtle); }
.notifications-segmented button { min-height: 26px; padding: 0 9px; border: 0; background: transparent; color: var(--text-muted); }
.notifications-segmented button.is-active { background: var(--bg-active); color: var(--text); }
.notifications-actions { min-height: 32px; }
.notifications-actions__select { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; }
.notifications-actions__count { margin-left: auto; color: var(--text-faint); font-size: 12px; }
.notifications-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; padding: 8px 10px; border-radius: 6px; font-size: 12px; }
.notifications-status a { color: inherit; font-weight: 600; }
.notifications-status.is-error { background: var(--err-soft); color: var(--err); }
.notifications-status.is-success { background: var(--ok-soft); color: var(--ok); }
.notifications-empty { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 7px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: 13px; }
.notifications-list { display: grid; margin: 0; padding: 0; border: 1px solid var(--border-soft); border-radius: 8px; overflow: hidden; list-style: none; }
.notification-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 64px; padding: 9px 10px; background: var(--bg-elev); }
.notification-row + .notification-row { border-top: 1px solid var(--border-soft); }
.notification-row.is-unread { background: color-mix(in srgb, var(--accent-soft) 28%, var(--bg-elev)); }
.notification-row__content { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
.notification-row__identity, .notification-row__meta { display: grid; min-width: 0; gap: 3px; }
.notification-row__identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.notification-row__identity span, .notification-row__meta { color: var(--text-muted); font-size: 11px; }
.notification-row__meta { flex: 0 0 auto; text-align: right; }
.notification-row__actions { display: flex; align-items: center; gap: 5px; }
.notification-row__actions button { min-height: 28px; padding-inline: 7px; font-size: 11px; }
.notification-row__unsubscribe:hover:not(:disabled) { color: var(--err); }
.notifications-more { justify-self: center; min-width: 120px; justify-content: center; }
.notifications-page__spin { animation: notifications-spin 0.8s linear infinite; }
@keyframes notifications-spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  .notification-row { grid-template-columns: auto minmax(0, 1fr); }
  .notification-row__content { align-items: flex-start; flex-direction: column; }
  .notification-row__meta { text-align: left; }
  .notification-row__actions { grid-column: 2; }
  .notifications-actions__count { width: 100%; margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { .notifications-page__spin { animation: none; } }
</style>
