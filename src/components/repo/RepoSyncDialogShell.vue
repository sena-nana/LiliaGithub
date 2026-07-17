<script setup lang="ts">
import type { DialogSize } from "../../ui/contract";
import { UiDialog } from "../../ui";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  description?: string;
  agentId: string;
  closeAgentId?: string;
  closeLabel?: string;
  size?: DialogSize;
  closeDisabled?: boolean;
}>(), {
  description: undefined,
  closeAgentId: undefined,
  closeLabel: "关闭",
  size: "default",
  closeDisabled: false,
});

const emit = defineEmits<{ close: [] }>();

function close() {
  if (!props.closeDisabled) emit("close");
}
</script>

<template>
  <UiDialog
    :open="open"
    :title="title"
    :description="description"
    :agent-id="agentId"
    :close-agent-id="closeAgentId"
    :close-label="closeLabel"
    :size="size"
    :close-disabled="closeDisabled"
    :close-on-escape="!closeDisabled"
    :close-on-outside="!closeDisabled"
    initial-focus="dialog"
    @close="close"
  >
    <slot />
    <template #actions><slot name="actions" /></template>
  </UiDialog>
</template>
