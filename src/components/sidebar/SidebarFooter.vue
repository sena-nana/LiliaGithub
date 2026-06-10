<script setup lang="ts">
import { RouterLink } from "vue-router";
import type {
  SidebarFooterLink,
  SidebarFooterStatus,
} from "../../config/appShell";

defineProps<{
  links: SidebarFooterLink[];
  status: SidebarFooterStatus;
}>();
</script>

<template>
  <div class="sb-footer">
    <RouterLink
      v-for="link in links"
      :key="link.label"
      :to="link.to"
      class="sb-footer__btn"
      active-class="is-active"
      :title="link.title ?? link.label"
      :aria-label="link.label"
    >
      <component :is="link.icon" :size="14" aria-hidden="true" />
    </RouterLink>

    <RouterLink
      :to="status.to"
      class="sb-conn"
      :class="`sb-conn--${status.tone}`"
      :title="status.title"
      :aria-label="status.title"
    >
      <component :is="status.icon" :size="12" aria-hidden="true" />
      <span class="sb-conn__label">{{ status.label }}</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.sb-footer {
  margin-top: auto;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: max-content;
  max-width: 100%;
}

.sb-footer__btn {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  opacity: 0.44;
  transition: opacity 0.35s ease, background-color 0.12s ease, color 0.12s ease;
  flex-shrink: 0;
}

.sb-footer__btn:hover {
  background: var(--bg-hover);
  color: var(--text);
  filter: none;
}

.sb-footer:hover .sb-footer__btn,
.sb-footer:focus-within .sb-footer__btn,
.sb-footer__btn.is-active {
  opacity: 1;
}

.sb-footer__btn.is-active {
  background: var(--accent-soft);
  color: var(--accent);
}

.sb-conn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  margin-left: 4px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  text-decoration: none;
  min-width: 0;
  opacity: 0.62;
  transition: opacity 0.35s ease, background-color 0.12s ease, color 0.12s ease;
}

.sb-footer:hover .sb-conn,
.sb-footer:focus-within .sb-conn {
  opacity: 1;
}

.sb-conn--ok {
  background: var(--accent-soft);
  color: var(--accent);
}

.sb-conn--warn {
  background: var(--warn-soft);
  color: var(--warn);
  opacity: 0.82;
}

.sb-conn--error {
  background: var(--err-soft);
  color: var(--err);
  opacity: 0.9;
}

.sb-conn__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
