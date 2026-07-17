<script setup lang="ts">
import type { GitHubRepoOwner } from "../../services/workspace/types";
import type { DiscoveryRepositoryScope } from "../../composables/discovery/useDiscoveryRepositories";

const props = defineProps<{
  modelValue: DiscoveryRepositoryScope;
  personalLogin: string;
  organizations: readonly GitHubRepoOwner[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: DiscoveryRepositoryScope] }>();

function scopeKey(scope: DiscoveryRepositoryScope) {
  return scope.kind === "organization" ? `organization:${scope.login}` : scope.kind;
}

function selectScope(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "frequent" || value === "all") {
    emit("update:modelValue", { kind: value });
  } else if (value === "personal") {
    emit("update:modelValue", { kind: "personal", login: props.personalLogin });
  } else if (value.startsWith("organization:")) {
    emit("update:modelValue", { kind: "organization", login: value.slice(13) });
  }
}
</script>

<template>
  <label class="discovery-scope">
    <span>仓库范围</span>
    <select :value="scopeKey(modelValue)" :disabled="disabled" data-agent-id="discovery.scope" @change="selectScope">
      <option value="frequent">常用仓库</option>
      <option value="all">全部仓库</option>
      <option v-if="personalLogin" value="personal">{{ personalLogin }}</option>
      <option v-for="owner in organizations" :key="owner.login" :value="`organization:${owner.login}`">{{ owner.login }}</option>
    </select>
  </label>
</template>

<style scoped>
.discovery-scope { display: inline-flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 12px; }
.discovery-scope select { min-height: 30px; padding: 0 28px 0 9px; border: 1px solid var(--border-soft); border-radius: 7px; color: var(--text); background: var(--bg-elev); }
</style>
