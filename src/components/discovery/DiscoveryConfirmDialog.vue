<script setup lang="ts">
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
  <Teleport to="body">
    <div v-if="open" class="confirm-backdrop" @click.self="$emit('cancel')">
      <section class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="title" :data-agent-id="agentId">
        <header><strong>{{ title }}</strong></header>
        <p>{{ description }}</p>
        <slot />
        <footer>
          <button type="button" class="ghost" :data-agent-id="`${agentId}.cancel`" :disabled="busy" @click="$emit('cancel')">取消</button>
          <button type="button" :class="danger ? 'danger' : 'primary'" :data-agent-id="`${agentId}.confirm`" :disabled="busy" @click="$emit('confirm')">
            {{ busy ? "正在处理..." : confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / 0.42); }
.confirm-dialog { width: min(420px, 100%); padding: 16px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-elev); box-shadow: 0 16px 42px rgb(0 0 0 / 0.22); }
.confirm-dialog header { color: var(--text); font-size: 14px; }
.confirm-dialog p { margin: 10px 0 16px; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
.confirm-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.confirm-dialog button { min-height: 30px; padding: 0 11px; }
.confirm-dialog .danger { border-color: transparent; color: white; background: var(--err); }
</style>
