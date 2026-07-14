<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  titleId: string;
  agentId: string;
  cardClass: string;
  closeDisabled?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();
const overlay = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      overlay.value?.focus();
    } else if (returnFocus) {
      await nextTick();
      returnFocus.focus();
      returnFocus = null;
    }
  },
);

function close() {
  if (!props.closeDisabled) emit("close");
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        ref="overlay"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :data-agent-id="agentId"
        tabindex="-1"
        @click.self="close"
        @keydown.esc.stop.prevent="close"
      >
        <section class="modal-card" :class="cardClass">
          <slot />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 2000);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.modal-overlay:focus {
  outline: none;
}

.modal-card {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: var(--shadow-lg, 0 14px 40px rgba(0, 0, 0, 0.45));
}

.modal-card :deep(button.ghost),
.modal-card :deep(button.primary) {
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.modal-card :deep(button.ghost) {
  background: transparent;
  color: var(--text-muted);
}

.modal-card :deep(button.ghost:hover:not(:disabled)) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.modal-card :deep(button.primary) {
  background: var(--accent);
  color: var(--accent-text);
}

.modal-card :deep(button.primary:hover:not(:disabled)) {
  background: var(--accent-strong);
}

.modal-card :deep(button:disabled) {
  cursor: default;
  opacity: 0.55;
}

.modal-card :deep(button:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}

.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-card,
.modal-leave-to .modal-card {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
