<script setup lang="ts">
import { AlertTriangle } from "@lucide/vue";

defineProps<{
  open: boolean;
  title: string;
  message: string;
  modelValue?: string;
  requiredText?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  busyText?: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
  "update:modelValue": [value: string];
}>();

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="modal-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        @click.self="emit('cancel')"
        @keydown="onKeydown"
      >
        <div class="modal-card dialog-card">
          <div class="dialog-card__header" :class="{ 'dialog-card__header--danger': danger }">
            <AlertTriangle v-if="danger" :size="14" aria-hidden="true" />
            <span>{{ title }}</span>
          </div>
          <div class="dialog-card__body">
            <p>{{ message }}</p>
            <label v-if="requiredText != null" class="dialog-card__field">
              <span>{{ inputLabel ?? "输入确认文本" }}</span>
              <input
                :value="modelValue ?? ''"
                type="text"
                :placeholder="inputPlaceholder ?? requiredText"
                :disabled="busy"
                @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
          <div class="dialog-card__actions">
            <button type="button" class="ghost" :disabled="busy" @click="emit('cancel')">
              {{ cancelText ?? "取消" }}
            </button>
            <button
              type="button"
              :class="danger ? 'ghost danger' : 'primary'"
              :disabled="busy || (requiredText != null && (modelValue ?? '') !== requiredText)"
              @click="emit('confirm')"
            >
              {{ busy ? (busyText ?? "处理中...") : (confirmText ?? "确认") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.modal-card {
  width: min(520px, 92vw);
  max-height: 72vh;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}

.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.16s ease;
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

.dialog-card {
  display: flex;
  flex-direction: column;
}

.dialog-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
  font-weight: 600;
}

.dialog-card__header--danger {
  color: var(--err);
}

.dialog-card__body {
  padding: 12px 14px;
}

.dialog-card__body p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
}

.dialog-card__field {
  display: grid;
  gap: 5px;
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.dialog-card__field input {
  width: 100%;
}

.dialog-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-soft);
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-card,
  .modal-leave-active .modal-card {
    transition: none;
  }

  .modal-enter-from .modal-card,
  .modal-leave-to .modal-card {
    transform: none;
  }
}
</style>
