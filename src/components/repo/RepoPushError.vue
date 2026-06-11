<script setup lang="ts">
import { AlertCircle, LoaderCircle, RotateCw } from "@lucide/vue";

defineProps<{
  message: string;
  retrying: boolean;
  actionRunning: boolean;
}>();

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <section class="repo-push-error" aria-label="最近同步失败">
    <AlertCircle :size="16" aria-hidden="true" />
    <div>
      <strong>最近同步失败</strong>
      <p>{{ message }}</p>
    </div>
    <button
      type="button"
      class="primary"
      :disabled="retrying || actionRunning"
      @click="$emit('retry')"
    >
      <LoaderCircle v-if="retrying" :size="14" aria-hidden="true" class="sb-spin" />
      <RotateCw v-else :size="14" aria-hidden="true" />
      重试
    </button>
  </section>
</template>
