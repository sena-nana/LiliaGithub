<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDown } from "@lucide/vue";

interface Option {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

const props = defineProps<{
  modelValue: T;
  options: readonly Option[];
  icon?: unknown;
  placeholder?: string;
  displayLabel?: string;
  overflowHint?: string;
  placement?: "top" | "bottom";
  disabled?: boolean;
  buttonClass?: string;
  menuWidth?: string;
  menuLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const current = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);
const showOverflowHint = computed(() => Boolean(props.overflowHint) && props.options.length > 8);

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

function pick(option: Option) {
  if (option.disabled) return;
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
      :class="[buttonClass, { 'is-open': open, 'is-disabled': disabled }]"
      :disabled="disabled"
      :aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      <component v-if="icon" :is="icon" :size="13" aria-hidden="true" />
      <span class="chat-chip__label">
        {{ displayLabel ?? current?.label ?? placeholder ?? "-" }}
      </span>
      <ChevronDown :size="12" aria-hidden="true" class="chat-chip__caret" />
    </button>

    <div
      v-if="open"
      class="dd__menu-shell"
      :class="placement === 'bottom' ? 'dd__menu-shell--bottom' : 'dd__menu-shell--top'"
      :style="menuWidth ? { width: menuWidth } : undefined"
    >
      <div
        class="dd__menu"
        :class="{ 'has-overflow-hint': showOverflowHint }"
        role="listbox"
        :aria-label="menuLabel"
      >
        <button
          v-for="option in options"
          :key="String(option.value)"
          type="button"
          class="dd__item"
          :class="{ 'is-active': option.value === modelValue }"
          :disabled="option.disabled"
          role="option"
          :aria-selected="option.value === modelValue"
          @click="pick(option)"
        >
          <span class="dd__item-label">{{ option.label }}</span>
          <span v-if="option.hint" class="dd__item-hint">{{ option.hint }}</span>
        </button>
      </div>
      <div v-if="showOverflowHint" class="dd__overflow-hint" aria-hidden="true">
        {{ props.overflowHint }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.chat-chip {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  min-width: 0;
  max-width: 100%;
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

.dd__menu-shell {
  position: absolute;
  left: 0;
  z-index: 20;
}

.dd__menu-shell--top {
  bottom: calc(100% + 6px);
}

.dd__menu-shell--bottom {
  top: calc(100% + 6px);
}

.dd__menu {
  min-width: 180px;
  max-width: 280px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 3px;
  display: flex;
  flex-direction: column;
  gap: 0;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  max-height: 280px;
  overflow: auto;
}

.dd__menu.has-overflow-hint {
  padding-bottom: 26px;
}

.dd__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  min-height: 26px;
  height: auto;
  font-weight: 500;
  font-size: 12px;
  line-height: 1.45;
  width: 100%;
  min-width: 0;
  white-space: nowrap;
}

.dd__item:hover,
.dd__item.is-active {
  background: var(--bg-hover);
  filter: none;
}

.dd__item:disabled {
  cursor: default;
  opacity: 0.45;
}

.dd__item:disabled:hover {
  background: transparent;
}

.dd__item-label {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dd__item-hint {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-faint);
}

.dd__overflow-hint {
  position: absolute;
  right: 8px;
  bottom: 6px;
  left: 8px;
  padding-top: 12px;
  background: linear-gradient(180deg, transparent 0%, var(--bg-elev) 72%);
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.3;
  text-align: center;
  pointer-events: none;
}
</style>
