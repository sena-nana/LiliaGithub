<script setup lang="ts">
import { computed, ref } from "vue";
import { Building2, Check, Search, UserRound } from "@lucide/vue";
import { SearchDropdown } from "../../ui";
import type { GitHubRepoOwner, GitHubRepositoryScope } from "../../services/workspace";

const props = withDefaults(defineProps<{
  modelValue: GitHubRepositoryScope;
  personalLogin: string;
  organizations: readonly GitHubRepoOwner[];
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}>(), {
  disabled: false,
  loading: false,
  compact: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: GitHubRepositoryScope];
}>();

const ownerQuery = ref("");
const ownerMenuOpen = ref(false);
const normalizedOwnerQuery = computed(() => ownerQuery.value.trim().toLocaleLowerCase());
const sortedOrganizations = computed(() =>
  [...props.organizations]
    .filter((owner) => owner.kind === "organization")
    .filter((owner) => !normalizedOwnerQuery.value || owner.login.toLocaleLowerCase().includes(normalizedOwnerQuery.value))
    .sort((left, right) => left.login.localeCompare(right.login)),
);
const selectedOrganization = computed(() => {
  const scope = props.modelValue;
  return scope.kind === "organization"
    ? props.organizations.find((owner) => owner.login === scope.login) ?? null
    : null;
});
const organizationPlaceholder = computed(() =>
  selectedOrganization.value?.login ?? (props.loading ? "正在加载组织" : "搜索组织"),
);

function selectAll() {
  if (props.disabled) return;
  emit("update:modelValue", { kind: "all" });
}

function selectPersonal() {
  if (props.disabled || !props.personalLogin) return;
  emit("update:modelValue", { kind: "personal", login: props.personalLogin });
}

function selectOrganization(owner: GitHubRepoOwner) {
  if (props.disabled) return;
  emit("update:modelValue", { kind: "organization", login: owner.login });
  ownerQuery.value = "";
  ownerMenuOpen.value = false;
}

function setOwnerMenuOpen(open: boolean) {
  ownerMenuOpen.value = open && !props.disabled && !props.loading;
}

function organizationSourceLabel(owner: GitHubRepoOwner) {
  return owner.source === "repository_access" ? "仓库访问" : "已关联";
}
</script>

<template>
  <div
    class="github-scope-control"
    :class="{ 'is-compact': compact }"
    role="group"
    aria-label="GitHub 仓库范围"
  >
    <button
      type="button"
      class="github-scope-control__option"
      :class="{ 'is-active': modelValue.kind === 'all' }"
      :aria-pressed="modelValue.kind === 'all'"
      data-agent-id="github.scope.all"
      :disabled="disabled"
      @click="selectAll"
    >
      全部
    </button>
    <button
      type="button"
      class="github-scope-control__option"
      :class="{ 'is-active': modelValue.kind === 'personal' }"
      :aria-pressed="modelValue.kind === 'personal'"
      data-agent-id="github.scope.personal"
      :disabled="disabled || !personalLogin"
      @click="selectPersonal"
    >
      <UserRound :size="13" aria-hidden="true" />
      <span>{{ personalLogin || "个人仓库" }}</span>
    </button>
    <SearchDropdown
      v-model="ownerQuery"
      :open="ownerMenuOpen"
      class="github-scope-control__organizations"
      :class="{ 'is-active': modelValue.kind === 'organization' }"
      :placeholder="organizationPlaceholder"
      input-agent-id="github.scope.organization.search"
      close-on-outside
      close-on-escape
      :aria-disabled="disabled || loading"
      @update:open="setOwnerMenuOpen"
    >
      <template #leading>
        <Building2 :size="13" aria-hidden="true" />
      </template>
      <template #default>
        <button
          v-for="owner in sortedOrganizations"
          :key="owner.login"
          type="button"
          class="github-scope-control__organization"
          role="option"
          :aria-selected="modelValue.kind === 'organization' && modelValue.login === owner.login"
          :data-agent-id="`github.scope.organization.${owner.login}`"
          @click="selectOrganization(owner)"
        >
          <img v-if="owner.avatarUrl" :src="owner.avatarUrl" alt="" />
          <Building2 v-else :size="14" aria-hidden="true" />
          <span class="github-scope-control__organization-copy">
            <strong>{{ owner.login }}</strong>
            <small>{{ organizationSourceLabel(owner) }}</small>
          </span>
          <Check
            v-if="modelValue.kind === 'organization' && modelValue.login === owner.login"
            :size="14"
            aria-hidden="true"
          />
        </button>
        <p v-if="!sortedOrganizations.length" class="github-scope-control__empty">
          <Search :size="13" aria-hidden="true" />
          {{ normalizedOwnerQuery ? "没有匹配的组织" : "没有可见组织" }}
        </p>
      </template>
    </SearchDropdown>
  </div>
</template>

<style scoped>
.github-scope-control {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.github-scope-control__option {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  color: var(--text-muted);
  background: var(--bg-elev);
  font-size: 12px;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}

.github-scope-control__option:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border);
  background: var(--bg-hover);
}

.github-scope-control__option.is-active {
  color: var(--accent-text);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.github-scope-control__organizations {
  width: min(210px, 34vw);
  min-width: 140px;
}

.github-scope-control__organizations :deep(.search-dropdown__field) {
  min-height: 30px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--border-soft);
  background: var(--bg-elev);
}

.github-scope-control__organizations.is-active :deep(.search-dropdown__field) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.github-scope-control__organizations :deep(.search-dropdown__input) {
  min-width: 0;
  height: 28px;
  font-size: 12px;
}

.github-scope-control__organization {
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 0;
  color: var(--text);
  background: transparent;
  text-align: left;
}

.github-scope-control__organization:hover {
  background: var(--bg-hover);
}

.github-scope-control__organization img {
  width: 20px;
  height: 20px;
  border-radius: 5px;
}

.github-scope-control__organization-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 1px;
}

.github-scope-control__organization-copy strong,
.github-scope-control__organization-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.github-scope-control__organization-copy strong {
  font-size: 12px;
  font-weight: 600;
}

.github-scope-control__organization-copy small {
  color: var(--text-faint);
  font-size: 11px;
}

.github-scope-control__empty {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 10px;
  color: var(--text-faint);
  font-size: 12px;
}

.github-scope-control.is-compact .github-scope-control__option {
  padding-inline: 8px;
}

@media (max-width: 760px) {
  .github-scope-control {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .github-scope-control__organizations {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .github-scope-control__option {
    transition: none;
  }
}
</style>
