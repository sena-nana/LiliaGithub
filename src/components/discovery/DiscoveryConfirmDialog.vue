<script setup lang="ts">
import { UiButton, UiDialog } from "../../ui";

withDefaults(defineProps<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  agentId: string;
  busy?: boolean;
  danger?: boolean;
}>(), { busy: false, danger: false });

defineEmits<{ cancel: []; confirm: [] }>();
</script>

<template>
  <UiDialog
    :open="open"
    :title="title"
    :description="description"
    :agent-id="agentId"
    :close-on-escape="!busy"
    :close-on-outside="!busy"
    @close="$emit('cancel')"
  >
    <slot />
    <template #actions>
      <UiButton
        variant="ghost"
        :agent-id="`${agentId}.cancel`"
        :disabled="busy"
        @click="$emit('cancel')"
      >
        取消
      </UiButton>
      <UiButton
        :variant="danger ? 'danger' : 'primary'"
        :agent-id="`${agentId}.confirm`"
        :busy="busy"
        @click="$emit('confirm')"
      >
        {{ busy ? "正在处理..." : confirmLabel }}
      </UiButton>
    </template>
  </UiDialog>
</template>
