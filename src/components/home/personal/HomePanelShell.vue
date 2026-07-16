<script setup lang="ts">
import { LoaderCircle, RefreshCw } from "@lucide/vue";

withDefaults(defineProps<{
  title: string;
  loading?: boolean;
  error?: string | null;
  refreshable?: boolean;
  agentId: string;
}>(), {
  loading: false,
  error: null,
  refreshable: false,
});

defineEmits<{ refresh: [] }>();
</script>

<template>
  <section class="card home-panel" :data-agent-id="agentId" :aria-label="title">
    <header class="home-panel__header">
      <h2>{{ title }}</h2>
      <button
        v-if="refreshable"
        type="button"
        class="home-panel__refresh"
        :aria-label="`刷新${title}`"
        :disabled="loading"
        @click="$emit('refresh')"
      >
        <LoaderCircle v-if="loading" :size="14" aria-hidden="true" class="sb-spin" />
        <RefreshCw v-else :size="14" aria-hidden="true" />
      </button>
    </header>
    <p v-if="error" class="home-panel__error" role="alert">{{ error }}</p>
    <slot v-else />
  </section>
</template>

<style scoped>
.home-panel { min-width: 0; padding: 12px; }
.home-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin-bottom: 8px; }
.home-panel__header h2 { margin: 0; color: var(--text); font-size: 13px; font-weight: 650; }
.home-panel__refresh { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); }
.home-panel__refresh:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.home-panel__refresh:disabled { opacity: 0.55; }
.home-panel__error { margin: 0; color: var(--err); font-size: 12px; line-height: 1.5; }
</style>
