<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDown } from "@lucide/vue";

interface Option {
  value: T;
  label: string;
  hint?: string;
}

const props = defineProps<{
  modelValue: T;
  options: Option[];
  icon?: unknown;
  placeholder?: string;
  placement?: "top" | "bottom";
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const current = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

function pick(option: Option) {
  emit("update:modelValue", option.value);
  open.value = false;
}

function onDocPointer(event: PointerEvent) {
  if (!root.value) return;
  if (!root.value.contains(event.target as Node)) open.value = false;
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) {
    open.value = false;
    event.stopPropagation();
  }
}

watch(open, async (value) => {
  if (value) {
    await nextTick();
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
  } else {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="dd">
    <button
      type="button"
      class="chat-chip"
      :class="{ 'is-open': open, 'is-disabled': disabled }"
      :disabled="disabled"
      :aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      <component v-if="icon" :is="icon" :size="13" aria-hidden="true" />
      <span class="chat-chip__label">
        {{ current?.label ?? placeholder ?? "-" }}
      </span>
      <ChevronDown :size="12" aria-hidden="true" class="chat-chip__caret" />
    </button>

    <div
      v-if="open"
      class="dd__menu"
      :class="placement === 'bottom' ? 'dd__menu--bottom' : 'dd__menu--top'"
      role="listbox"
    >
      <button
        v-for="option in options"
        :key="String(option.value)"
        type="button"
        class="dd__item"
        :class="{ 'is-active': option.value === modelValue }"
        role="option"
        :aria-selected="option.value === modelValue"
        @click="pick(option)"
      >
        <span class="dd__item-label">{{ option.label }}</span>
        <span v-if="option.hint" class="dd__item-hint">{{ option.hint }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
}

.chat-chip {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.chat-chip:hover:not(.is-disabled):not(:disabled),
.chat-chip.is-open {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.chat-chip__label {
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dd__menu {
  position: absolute;
  left: 0;
  min-width: 180px;
  max-width: 280px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  z-index: 20;
}

.dd__menu--top {
  bottom: calc(100% + 6px);
}

.dd__menu--bottom {
  top: calc(100% + 6px);
}

.dd__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  height: auto;
  font-weight: 500;
}

.dd__item:hover,
.dd__item.is-active {
  background: var(--bg-hover);
  filter: none;
}

.dd__item-hint {
  font-size: 11px;
  color: var(--text-faint);
}
</style>
