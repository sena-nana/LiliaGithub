<script setup lang="ts">
import { computed } from "vue";
import type { DiscoveryAggregateResult, DiscoveryRecentRelease } from "../../services/discovery/types";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { discoveryDate, discoveryProjectRoute } from "./display";

const props = defineProps<{
  result: DiscoveryAggregateResult<DiscoveryRecentRelease> | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>();
const items = computed(() => props.result?.items ?? []);
</script>

<template>
  <DiscoveryPanel title="近期 Releases" agent-id="discovery.release" :loading="loading" :error="error" :item-count="items.length" :failure-count="result?.failures.length ?? 0" :truncated-count="result?.truncated ? 1 : 0" empty-message="近 30 天没有已发布的 Release。" @retry="refresh">
    <DiscoveryItemRow v-for="item in items" :key="`${item.repoFullName}:${item.release.id}`" :title="item.release.name || item.release.tagName" :repository="item.repoFullName" :meta="discoveryDate(item.release.publishedAt)" :to="discoveryProjectRoute(item.repoFullName, 'release', undefined, item.release.tagName)" :agent-id="`discovery.release.row.${item.repoFullName}:${item.release.id}`">
      <template v-if="item.release.prerelease" #badges><span class="prerelease">预发布</span></template>
    </DiscoveryItemRow>
  </DiscoveryPanel>
</template>

<style scoped>.prerelease { padding: 2px 5px; border-radius: 5px; color: var(--warn); background: var(--warn-soft); font-size: 10px; }</style>
