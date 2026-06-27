<script setup lang="ts" generic="T extends string | number">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDown } from "@lucide/vue";
import { SB_MENU_POP_TRANSITION_MS } from "../composables/menuMotion";
import { useAnchoredMenuMotion } from "../composables/useAnchoredMenuMotion";

interface Option {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
  agentId?: string;
}

const props = defineProps<{
  modelValue: T | readonly T[];
  options: readonly Option[];
  icon?: unknown;
  placeholder?: string;
  displayLabel?: string;
  multiple?: boolean;
  placement?: "top" | "bottom";
  disabled?: boolean;
  buttonClass?: string;
  agentId?: string;
  menuWidth?: string;
  menuLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: any] }>();

const open = ref(false);
const placement = computed(() =>
  props.placement === "bottom" ? "bottom" : "top",
);
const menuMotion = useAnchoredMenuMotion(placement);
const root = menuMotion.rootEl;
const origin = menuMotion.origin;

const current = computed(() =>
  props.multiple ? undefined : props.options.find((option) => option.value === props.modelValue),
);
const selectedValues = computed(() =>
  props.multiple && Array.isArray(props.modelValue) ? props.modelValue : [],
);
const buttonLabel = computed(() => {
  if (props.displayLabel) return props.displayLabel;
  if (!props.multiple) return current.value?.label ?? props.placeholder ?? "-";
  const selected = props.options.filter((option) => selectedValues.value.includes(option.value));
  if (!selected.length) return props.placeholder ?? "-";
  if (selected.length <= 2) return selected.map((option) => option.label).join(", ");
  return `${selected.slice(0, 2).map((option) => option.label).join(", ")} +${selected.length - 2}`;
});

const placementClass = computed(() => `dd__menu--${placement.value}`);

function toggle(event: MouseEvent) {
  if (props.disabled) return;
  menuMotion.captureAnchor(event);
  open.value = !open.value;
}

function pick(option: Option) {
  if (option.disabled) return;
  if (props.multiple) {
    const values = selectedValues.value;
    emit(
      "update:modelValue",
      values.includes(option.value)
        ? values.filter((value) => value !== option.value)
        : [...values, option.value],
    );
    return;
  }
  emit("update:modelValue", option.value);
  open.value = false;
}

function isSelected(option: Option) {
  return props.multiple
    ? selectedValues.value.includes(option.value)
    : option.value === props.modelValue;
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
    menuMotion.resolveInitialOrigin();
    await menuMotion.updateOrigin();
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
      :ref="menuMotion.triggerEl"
      type="button"
      class="chat-chip"
      :class="[buttonClass, { 'is-open': open, 'is-disabled': disabled }]"
      :data-agent-id="agentId"
      :disabled="disabled"
      :aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      <component v-if="icon" :is="icon" :size="13" aria-hidden="true" />
      <span class="chat-chip__label">
        {{ buttonLabel }}
      </span>
      <ChevronDown :size="12" aria-hidden="true" class="chat-chip__caret" />
    </button>

    <Transition name="sb-menu-pop" :duration="SB_MENU_POP_TRANSITION_MS">
      <div
        v-if="open"
        :ref="menuMotion.menuEl"
        class="dd__menu"
        :class="placementClass"
        role="listbox"
        :aria-multiselectable="multiple ? 'true' : undefined"
        :aria-label="menuLabel"
        :style="[
          {
            '--sb-menu-origin-x': `${origin.x}px`,
            '--sb-menu-origin-y': `${origin.y}px`,
          },
          menuWidth ? { width: menuWidth } : null,
        ]"
      >
        <button
          v-for="option in options"
          :key="String(option.value)"
          type="button"
          class="dd__item"
          :class="{ 'is-active': isSelected(option), 'is-multiple': multiple }"
          :disabled="option.disabled"
          role="option"
          :aria-selected="isSelected(option)"
          :data-agent-id="option.agentId"
          @click="pick(option)"
        >
          <span v-if="multiple" class="dd__item-check" aria-hidden="true">
            <span v-if="isSelected(option)"></span>
          </span>
          <span class="dd__item-label">{{ option.label }}</span>
          <span v-if="option.hint" class="dd__item-hint">{{ option.hint }}</span>
        </button>
      </div>
    </Transition>
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

.dd__menu {
  position: absolute;
  left: 0;
  z-index: 20;
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
  transform-origin: var(--sb-menu-origin-x, 0px) var(--sb-menu-origin-y, 0px);
  will-change: transform, opacity;
}

.dd__menu--top {
  bottom: calc(100% + 6px);
}

.dd__menu--bottom {
  top: calc(100% + 6px);
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

.dd__item:hover:not(:disabled),
.dd__item.is-active {
  background: var(--bg-hover);
  filter: none;
}

.dd__item.is-multiple {
  align-items: center;
}

.dd__item-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-subtle);
}

.dd__item-check span {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--accent);
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
</style>
