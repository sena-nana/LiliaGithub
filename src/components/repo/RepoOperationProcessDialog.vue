<script setup lang="ts">
import { UiDialog } from "@lilia/ui";

defineProps<{
  open: boolean;
  process: string;
  agentId?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <UiDialog
    :open="open"
    title="运行过程"
    :agent-id="agentId ?? 'repo.error.process-dialog'"
    size="medium"
    close-label="关闭"
    @close="emit('close')"
  >
    <pre class="operation-process" data-agent-id="repo.error.process-dialog.log">{{ process }}</pre>
    <template #actions>
      <button type="button" class="ghost" data-agent-id="repo.error.process-dialog.close" @click="emit('close')">关闭</button>
    </template>
  </UiDialog>
</template>

<style scoped>
.operation-process {
  margin: 0;
  max-height: min(52vh, 420px);
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
