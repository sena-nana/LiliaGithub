<script setup lang="ts">
import { LoaderCircle, RefreshCw } from "@lucide/vue";

withDefaults(defineProps<{
  title: string;
  agentId: string;
  loading?: boolean;
  error?: string | null;
  itemCount?: number;
  failureCount?: number;
  truncatedCount?: number;
  emptyMessage: string;
}>(), {
  loading: false,
  error: null,
  itemCount: 0,
  failureCount: 0,
  truncatedCount: 0,
});

defineEmits<{ retry: [] }>();
</script>

<template>
  <section class="discovery-panel card" :aria-label="title" :data-agent-id="agentId">
    <header class="discovery-panel__header">
      <div>
        <h2>{{ title }}</h2>
        <span v-if="itemCount" class="discovery-panel__count">{{ itemCount }}</span>
      </div>
      <button
        type="button"
        class="ghost discovery-panel__refresh"
        :aria-label="`刷新${title}`"
        :data-agent-id="`${agentId}.refresh`"
        :disabled="loading"
        @click="$emit('retry')"
      >
        <RefreshCw :size="14" aria-hidden="true" :class="{ 'sb-spin': loading }" />
      </button>
    </header>

    <div v-if="loading && !itemCount" class="discovery-panel__state" role="status">
      <LoaderCircle :size="16" aria-hidden="true" class="sb-spin" />
      <span>正在加载...</span>
    </div>
    <div v-else-if="error && !itemCount" class="discovery-panel__state is-error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="ghost" :data-agent-id="`${agentId}.retry`" @click="$emit('retry')">重试</button>
    </div>
    <div v-else-if="!itemCount" class="discovery-panel__state is-empty">
      <p>{{ emptyMessage }}</p>
    </div>
    <div v-else class="discovery-panel__content" :aria-busy="loading">
      <slot />
    </div>

    <footer v-if="itemCount && (error || failureCount || truncatedCount)" class="discovery-panel__partial" role="status">
      <span v-if="failureCount">{{ failureCount }} 个仓库暂时无法读取。</span>
      <span v-if="truncatedCount">{{ truncatedCount }} 个仓库还有更多内容，可进入仓库查看。</span>
      <span v-if="error">刷新失败，当前仍显示上次结果。</span>
      <button v-if="error || failureCount" type="button" class="ghost" :data-agent-id="`${agentId}.retry-partial`" @click="$emit('retry')">重试</button>
    </footer>
  </section>
</template>

<style scoped>
.discovery-panel { min-width: 0; padding: 0; overflow: hidden; }
.discovery-panel__header { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--border-soft); }
.discovery-panel__header > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
.discovery-panel h2 { margin: 0; color: var(--text); font-size: 13px; font-weight: 600; }
.discovery-panel__count { min-width: 20px; padding: 1px 5px; border-radius: 999px; color: var(--text-muted); background: var(--bg-subtle); font-size: 11px; text-align: center; }
.discovery-panel__refresh { width: 28px; height: 28px; display: inline-grid; place-items: center; padding: 0; }
.discovery-panel__state { min-height: 118px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 20px; color: var(--text-muted); font-size: 12px; text-align: center; }
.discovery-panel__state p { margin: 0; }
.discovery-panel__state.is-error { flex-direction: column; color: var(--err); }
.discovery-panel__content { display: grid; }
.discovery-panel__partial { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 8px 12px; border-top: 1px solid var(--border-soft); color: var(--warn); background: var(--warn-soft); font-size: 11px; }
.discovery-panel__partial .ghost { margin-left: auto; }
</style>
