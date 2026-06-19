<script setup lang="ts">
import { KeyRound, LoaderCircle } from "@lucide/vue";

defineProps<{
  title: string;
  reason: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  rebind: [];
}>();
</script>

<template>
  <section class="repo-github-unavailable">
    <div>
      <strong>{{ title }}</strong>
      <span>{{ reason }}</span>
    </div>
    <button type="button" class="primary" :disabled="loading" @click="emit('rebind')">
      <LoaderCircle v-if="loading" :size="14" aria-hidden="true" class="sb-spin" />
      <KeyRound v-else :size="14" aria-hidden="true" />
      重新绑定 GitHub
    </button>
  </section>
</template>

<style scoped>
.repo-github-unavailable {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--warn-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--warn-soft) 52%, var(--bg-subtle));
}

.repo-github-unavailable div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.repo-github-unavailable strong {
  color: var(--text);
  font-size: 13px;
}

.repo-github-unavailable span {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.repo-github-unavailable button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

@media (max-width: 900px) {
  .repo-github-unavailable {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
