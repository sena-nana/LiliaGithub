<script setup lang="ts">
import { AlertTriangle, LoaderCircle, RefreshCw } from "@lucide/vue";

withDefaults(defineProps<{
  state: "loading" | "empty" | "limited" | "error";
  message?: string;
  retryable?: boolean;
  compact?: boolean;
  actionLabel?: string;
}>(), {
  message: "",
  retryable: false,
  compact: false,
  actionLabel: "补充组织权限",
});

const emit = defineEmits<{
  retry: [];
  authorize: [];
}>();
</script>

<template>
  <div
    class="github-repository-state"
    :class="[`is-${state}`, { 'is-compact': compact }]"
    :role="state === 'error' ? 'alert' : 'status'"
  >
    <LoaderCircle v-if="state === 'loading'" :size="14" aria-hidden="true" class="sb-spin" />
    <AlertTriangle v-else-if="state === 'limited' || state === 'error'" :size="14" aria-hidden="true" />
    <span>{{ message || (state === "empty" ? "当前范围没有可见仓库。" : "正在加载仓库…") }}</span>
    <button
      v-if="state === 'limited'"
      type="button"
      class="ghost github-repository-state__action"
      data-agent-id="github.repository-state.authorize"
      @click="emit('authorize')"
    >
      {{ actionLabel }}
    </button>
    <button
      v-else-if="state === 'error' && retryable"
      type="button"
      class="ghost github-repository-state__action"
      data-agent-id="github.repository-state.retry"
      @click="emit('retry')"
    >
      <RefreshCw :size="12" aria-hidden="true" />
      重试
    </button>
  </div>
</template>

<style scoped>
.github-repository-state {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  color: var(--text-muted);
  background: var(--bg-subtle);
  font-size: 12px;
}

.github-repository-state.is-limited {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 35%, var(--border-soft));
  background: var(--warn-soft);
}

.github-repository-state.is-error {
  color: var(--err);
  border-color: color-mix(in srgb, var(--err) 35%, var(--border-soft));
  background: var(--err-soft);
}

.github-repository-state.is-compact {
  min-height: 28px;
  padding: 5px 7px;
}

.github-repository-state__action {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 0 6px;
  color: inherit;
  white-space: nowrap;
}
</style>
