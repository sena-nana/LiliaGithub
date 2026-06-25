<script setup lang="ts">
import { X } from "@lucide/vue";

const props = withDefaults(defineProps<{
  modelValue: string[];
  draft: string;
  placeholder?: string;
  agentIdPrefix?: string;
}>(), {
  placeholder: "Add topics",
  agentIdPrefix: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
  "update:draft": [value: string];
}>();

function normalizeTopic(value: string) {
  return value.trim().replace(/^#+/, "").toLowerCase();
}

function appendTopics(rawValue: string) {
  const next = [...props.modelValue];
  for (const topic of rawValue.split(/[\s,]+/).map(normalizeTopic).filter(Boolean)) {
    if (!next.includes(topic)) next.push(topic);
  }
  emit("update:modelValue", next);
}

function commitDraft() {
  appendTopics(props.draft);
  emit("update:draft", "");
}

function removeTopic(topic: string) {
  emit("update:modelValue", props.modelValue.filter((item) => item !== topic));
}

function handleKey(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    commitDraft();
    return;
  }
  if (event.key === "Backspace" && !props.draft && props.modelValue.length) {
    emit("update:modelValue", props.modelValue.slice(0, -1));
  }
}

function handlePaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text) return;
  event.preventDefault();
  appendTopics(text);
  emit("update:draft", "");
}
</script>

<template>
  <div class="repo-topic-editor">
    <button
      v-for="topic in modelValue"
      :key="topic"
      type="button"
      class="repo-topic-editor__token"
      :data-agent-id="agentIdPrefix ? `${agentIdPrefix}.remove.${topic}` : undefined"
      :aria-label="`移除 ${topic}`"
      @click="removeTopic(topic)"
    >
      {{ topic }}
      <X :size="12" aria-hidden="true" />
    </button>
    <input
      :value="draft"
      type="text"
      :placeholder="placeholder"
      :data-agent-id="agentIdPrefix ? `${agentIdPrefix}.input` : undefined"
      @input="emit('update:draft', ($event.target as HTMLInputElement).value)"
      @keydown="handleKey"
      @blur="commitDraft"
      @paste="handlePaste"
    />
  </div>
</template>

<style scoped>
.repo-topic-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 32px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.repo-topic-editor__token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-height: 20px;
  padding: 0 6px 0 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.repo-topic-editor input {
  flex: 1 1 96px;
  width: auto;
  min-width: 80px;
  height: 24px;
  border: 0;
  padding: 0 4px;
  background: transparent;
  box-shadow: none;
}
</style>
