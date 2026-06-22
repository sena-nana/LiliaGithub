<script setup lang="ts">
import { toRef } from "vue";
import type { RepoChange } from "../../services/workspace/types";
import RepoFilePreviewPane from "./RepoFilePreviewPane.vue";
import RepoFileTreeCard from "./RepoFileTreeCard.vue";
import { useRepoFileBrowser } from "./useRepoFileBrowser";

const props = defineProps<{
  repoId: string;
  repoPath?: string | null;
  repoRef?: string | null;
  changes?: readonly RepoChange[];
  targetPath?: string | null;
  targetHash?: string | null;
}>();

const browser = useRepoFileBrowser({
  repoId: toRef(props, "repoId"),
  repoPath: toRef(props, "repoPath"),
  repoRef: toRef(props, "repoRef"),
  changes: toRef(props, "changes"),
  targetPath: toRef(props, "targetPath"),
  targetHash: toRef(props, "targetHash"),
});
</script>

<template>
  <section class="files-panel">
    <div class="files-layout">
      <RepoFilePreviewPane :browser="browser" />
      <RepoFileTreeCard :browser="browser" />
    </div>
  </section>
</template>

<style scoped>
.files-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.files-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 280px);
  gap: 14px;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

@media (max-width: 900px) {
  .files-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .files-layout :deep(.files-sidebar) {
    order: -1;
  }

  .files-layout :deep(.files-sidebar__card) {
    max-height: 280px;
  }
}
</style>
