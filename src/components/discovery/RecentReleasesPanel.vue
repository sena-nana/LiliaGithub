<script setup lang="ts">
import { computed } from "vue";
import { loadDiscoveryRecentReleases } from "../../services/discovery";
import { useDiscoverySection } from "../../composables/discovery/useDiscoverySection";
import type { DiscoveryRepositoryInput } from "./types";
import DiscoveryItemRow from "./DiscoveryItemRow.vue";
import DiscoveryPanel from "./DiscoveryPanel.vue";
import { discoveryDate, discoveryProjectRoute } from "./display";

const props = withDefaults(defineProps<{ repositories: readonly DiscoveryRepositoryInput[]; refreshToken?: number }>(), { refreshToken: 0 });
const section = useDiscoverySection(props, (forceRefresh) =>
  loadDiscoveryRecentReleases(props.repositories.map((repo) => repo.fullName), { forceRefresh }));
const items = computed(() => section.result.value?.items ?? []);
</script>

<template>
  <DiscoveryPanel title="近期 Releases" agent-id="discovery.release" :loading="section.loading.value" :error="section.error.value" :item-count="items.length" :failure-count="section.result.value?.failures.length ?? 0" :truncated-count="section.result.value?.truncated ? 1 : 0" empty-message="近 30 天没有已发布的 Release。" @retry="section.load(true)">
    <DiscoveryItemRow v-for="item in items" :key="`${item.repoFullName}:${item.release.id}`" :title="item.release.name || item.release.tagName" :repository="item.repoFullName" :meta="discoveryDate(item.release.publishedAt)" :to="discoveryProjectRoute(item.repoFullName, 'release', undefined, item.release.tagName)" :agent-id="`discovery.release.row.${item.repoFullName}:${item.release.id}`">
      <template v-if="item.release.prerelease" #badges><span class="prerelease">预发布</span></template>
    </DiscoveryItemRow>
  </DiscoveryPanel>
</template>

<style scoped>.prerelease { padding: 2px 5px; border-radius: 5px; color: var(--warn); background: var(--warn-soft); font-size: 10px; }</style>
