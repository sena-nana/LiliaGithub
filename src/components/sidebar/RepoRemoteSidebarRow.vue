<script setup lang="ts">
import { GitPullRequestArrow, X } from "@lucide/vue";
import type { RemoteRepoShortcut } from "../../services/workspace";

defineProps<{
  repo: Readonly<RemoteRepoShortcut>;
  active: boolean;
  agentId: string;
  removeAgentId: string;
  openLabel: string;
}>();

defineEmits<{
  open: [];
  remove: [];
}>();
</script>

<template>
  <div
    class="sb-tree__row sb-tree__row--project sb-tree__row--remote"
    :class="{ 'is-active': active }"
    role="link"
    tabindex="0"
    :data-agent-id="agentId"
    :title="repo.fullName"
    :aria-label="openLabel"
    @click="$emit('open')"
    @keydown.enter.prevent="$emit('open')"
    @keydown.space.prevent="$emit('open')"
  >
    <GitPullRequestArrow :size="14" aria-hidden="true" class="sb-tree__repo-icon is-remote" />
    <span class="sb-tree__name">{{ repo.name }}</span>
    <span v-if="repo.archived" class="sb-badge">ARCH</span>
    <span v-if="repo.private" class="sb-badge">私有</span>
    <button
      type="button"
      class="sb-icon-btn sb-tree__remote-remove"
      :data-agent-id="removeAgentId"
      :aria-label="`移除 ${repo.fullName}`"
      title="从侧边栏移除"
      @click.stop="$emit('remove')"
    >
      <X :size="13" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.sb-tree__row--remote {
  cursor: pointer;
}

.sb-tree__remote-remove {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.sb-tree__remote-remove:hover {
  background: var(--bg-hover);
  color: var(--text);
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

@media (prefers-reduced-motion: reduce) {
  .sb-tree__remote-remove {
    transition: none;
  }
}
</style>
