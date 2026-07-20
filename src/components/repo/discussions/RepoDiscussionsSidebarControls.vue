<script setup lang="ts">
import { MessagesSquare, Plus } from "@lucide/vue";
import { Dropdown } from "../../../ui";
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRepoDiscussionsStore } from "./useRepoDiscussions";

const props = defineProps<{
  repoFullName: string;
  createView: boolean;
  focusedDiscussionNumber: number | null;
  unavailableReason?: string | null;
}>();

const emit = defineEmits<{ create: [] }>();
const store = useRepoDiscussionsStore(() => props.repoFullName);
const route = useRoute();
const router = useRouter();
const metadata = computed(() => store.value.list.metadata.value);
const createDisabled = computed(() => Boolean(
  props.unavailableReason ||
  props.createView ||
  props.focusedDiscussionNumber ||
  !metadata.value?.enabled ||
  !metadata.value.creatableCategories.length ||
  store.value.create.creating.value,
));
const categoryOptions = computed(() => [
  { value: "", label: "全部分类" },
  ...(metadata.value?.categories.map((category) => ({
    value: category.id,
    label: `${category.emoji} ${category.name}`,
  })) ?? []),
]);
const answeredOptions = [
  { value: "all", label: "全部回答状态" },
  { value: "answered", label: "已回答" },
  { value: "unanswered", label: "未回答" },
];
const sortOptions = [
  { value: "updated-desc", label: "最近更新" },
  { value: "updated-asc", label: "最早更新" },
  { value: "created-desc", label: "最新创建" },
  { value: "created-asc", label: "最早创建" },
];
const answeredValue = computed(() => {
  const value = store.value.list.filters.answered;
  return value == null ? "all" : value ? "answered" : "unanswered";
});
const sortValue = computed(() => `${store.value.list.filters.sort}-${store.value.list.filters.direction}`);

watch(() => props.repoFullName, () => {
  Object.assign(store.value.list.filters, discussionFiltersFromRoute());
  if (!props.unavailableReason) void store.value.list.ensureLoaded();
}, { immediate: true });

watch(
  () => [
    route.query.discussionState,
    route.query.discussionCategory,
    route.query.discussionAnswered,
    route.query.discussionSort,
    route.query.discussionDirection,
  ],
  () => {
    const next = discussionFiltersFromRoute();
    const current = store.value.list.filters;
    if (
      current.state !== next.state ||
      current.categoryId !== next.categoryId ||
      current.answered !== next.answered ||
      current.sort !== next.sort ||
      current.direction !== next.direction
    ) void store.value.list.updateFilters(next);
  },
);

function queryString(value: unknown) {
  const next = Array.isArray(value) ? value[0] : value;
  return typeof next === "string" && next.trim() ? next.trim() : null;
}

function discussionFiltersFromRoute() {
  const state = queryString(route.query.discussionState);
  const answered = queryString(route.query.discussionAnswered);
  const sort = queryString(route.query.discussionSort);
  const direction = queryString(route.query.discussionDirection);
  return {
    state: state === "closed" || state === "all" ? state : "open",
    categoryId: queryString(route.query.discussionCategory),
    answered: answered === "answered" ? true : answered === "unanswered" ? false : null,
    sort: sort === "created" ? "created" : "updated",
    direction: direction === "asc" ? "asc" : "desc",
  } as const;
}

async function updateDiscussionFilters(next: Partial<ReturnType<typeof discussionFiltersFromRoute>>) {
  await store.value.list.updateFilters(next);
  const filters = store.value.list.filters;
  const query = { ...route.query };
  const set = (key: string, value: string | null) => {
    if (value) query[key] = value;
    else delete query[key];
  };
  set("discussionState", filters.state === "open" ? null : filters.state);
  set("discussionCategory", filters.categoryId);
  set("discussionAnswered", filters.answered == null ? null : filters.answered ? "answered" : "unanswered");
  set("discussionSort", filters.sort === "updated" ? null : filters.sort);
  set("discussionDirection", filters.direction === "desc" ? null : filters.direction);
  await router.replace({ path: route.path, query, hash: route.hash });
}

function setAnswered(value: string) {
  void updateDiscussionFilters({ answered: value === "all" ? null : value === "answered" });
}

function setSort(value: string) {
  const [sort, direction] = value.split("-") as ["created" | "updated", "asc" | "desc"];
  void updateDiscussionFilters({ sort, direction });
}
</script>

<template>
  <section class="card discussion-sidebar" aria-label="Discussions 筛选项">
    <header>
      <div><MessagesSquare :size="14" /><strong>Discussions</strong></div>
      <button
        type="button"
        class="primary discussion-sidebar__create"
        data-agent-id="repo.discussions.create"
        :disabled="createDisabled"
        @click="emit('create')"
      >
        <Plus :size="14" /> 新建
      </button>
    </header>
    <p v-if="metadata?.enabled && !metadata.creatableCategories.length" class="muted discussion-sidebar__notice">
      当前账号可浏览，但不能创建 Discussion。
    </p>
    <div class="discussion-sidebar__states" role="group" aria-label="Discussion 状态">
      <button
        v-for="state in ['open', 'closed', 'all'] as const"
        :key="state"
        type="button"
        class="ghost"
        :class="{ 'is-active': store.list.filters.state === state }"
        :data-agent-id="`repo.discussions.state.${state}`"
        @click="updateDiscussionFilters({ state })"
      >
        {{ state === "open" ? "Open" : state === "closed" ? "Closed" : "All" }}
      </button>
    </div>
    <label>
      <span>分类</span>
      <Dropdown
        :model-value="store.list.filters.categoryId ?? ''"
        :options="categoryOptions"
        menu-label="Discussion 分类筛选"
        agent-id="repo.discussions.filters.category"
        @update:model-value="updateDiscussionFilters({ categoryId: $event || null })"
      />
    </label>
    <label>
      <span>回答</span>
      <Dropdown
        :model-value="answeredValue"
        :options="answeredOptions"
        menu-label="Discussion 回答筛选"
        agent-id="repo.discussions.filters.answered"
        @update:model-value="setAnswered"
      />
    </label>
    <label>
      <span>排序</span>
      <Dropdown
        :model-value="sortValue"
        :options="sortOptions"
        menu-label="Discussion 排序"
        agent-id="repo.discussions.filters.sort"
        @update:model-value="setSort"
      />
    </label>
    <dl>
      <div><dt>已加载</dt><dd>{{ store.list.items.value.length }}</dd></div>
      <div><dt>总计</dt><dd>{{ store.list.totalCount.value }}</dd></div>
    </dl>
  </section>
</template>

<style scoped>
.discussion-sidebar {
  display: grid;
  gap: var(--repo-sidebar-card-gap);
  min-width: 0;
  margin: 0;
  padding: var(--repo-sidebar-card-padding);
}

.discussion-sidebar header,
.discussion-sidebar header > div,
.discussion-sidebar__create,
.discussion-sidebar__states,
.discussion-sidebar dl div {
  display: flex;
  align-items: center;
  gap: 6px;
}

.discussion-sidebar header {
  justify-content: space-between;
}

.discussion-sidebar__create {
  min-height: var(--repo-sidebar-control-height);
}

.discussion-sidebar__states {
  gap: 3px;
}

.discussion-sidebar__states button {
  flex: 1;
  min-width: 0;
  min-height: 28px;
  padding-inline: 5px;
}

.discussion-sidebar__states button.is-active {
  background: var(--bg-active);
  color: var(--text);
}

.discussion-sidebar label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.discussion-sidebar dl {
  display: grid;
  gap: 3px;
  margin: 0;
}

.discussion-sidebar dl div {
  justify-content: space-between;
  min-height: 26px;
}

.discussion-sidebar dt {
  color: var(--text-muted);
  font-size: 11px;
}

.discussion-sidebar dd {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
}

.discussion-sidebar__notice {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
}
</style>
