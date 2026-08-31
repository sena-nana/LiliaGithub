<script setup lang="ts">
/**
 * Phase E / X3 business evidence host (Lilia Nana path).
 * Opens Dialog / Drawer / ContextMenu via Nana Overlay components;
 * Dropdown maps to NanaSelect (not CSS fixed Teleport menus).
 * Invisible when closed — does not affect home/settings SSIM baselines.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  closeContextMenu,
  openContextMenuAt,
  useContextMenu,
} from "@lilia/ui/composables/useContextMenu";
import {
  NanaDialog,
  NanaDrawer,
  NanaDropdown,
} from "@nanaui/nanavue-components";

const dialogOpen = ref(false);
const drawerOpen = ref(false);
const dropdownValue = ref("alpha");
const contextMenu = useContextMenu();

type OverlayEvidenceState = {
  ok: boolean;
  dialog: boolean;
  drawer: boolean;
  contextMenu: boolean;
  dropdown: boolean;
  path: "nana-overlay";
  fixedEngine: false;
};

function snapshot(): OverlayEvidenceState {
  return {
    ok: true,
    dialog: dialogOpen.value,
    drawer: drawerOpen.value,
    contextMenu: !!contextMenu.state.open,
    dropdown: true,
    path: "nana-overlay",
    fixedEngine: false,
  };
}

function openAll(): OverlayEvidenceState {
  dialogOpen.value = true;
  drawerOpen.value = true;
  openContextMenuAt(220, 180, [
    { id: "cut", label: "剪切" },
    { id: "copy", label: "复制" },
    {
      id: "file",
      label: "文件",
      children: [{ id: "rename", label: "重命名" }],
    },
  ]);
  return snapshot();
}

function closeAll(): OverlayEvidenceState {
  dialogOpen.value = false;
  drawerOpen.value = false;
  closeContextMenu();
  return snapshot();
}

onMounted(() => {
  const api = {
    openAll,
    closeAll,
    snapshot,
  };
  (
    globalThis as {
      __nanaOverlayEvidence?: typeof api;
    }
  ).__nanaOverlayEvidence = api;
});

onBeforeUnmount(() => {
  const g = globalThis as {
    __nanaOverlayEvidence?: unknown;
  };
  if (g.__nanaOverlayEvidence) delete g.__nanaOverlayEvidence;
});
</script>

<template>
  <div
    class="nana-overlay-evidence"
    data-agent-id="nana.overlay.evidence"
    data-nana-overlay-path="true"
    aria-hidden="true"
    style="height: 0; max-height: 0; overflow: hidden; opacity: 0;"
  >
    <!-- Dropdown → NanaSelect (iced pick-list); never CSS fixed menu. -->
    <NanaDropdown
      v-model="dropdownValue"
      :options="[
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ]"
      placeholder="Overlay evidence dropdown"
      agent-id="nana.overlay.evidence.dropdown"
    />
    <NanaDialog
      v-model:open="dialogOpen"
      title="Overlay 证据 Dialog"
      description="Lilia Nana 路径 · Nana Overlay（非 CSS fixed）"
      data-agent-id="nana.overlay.evidence.dialog"
    >
      <p>Phase E / X3 business evidence dialog body.</p>
    </NanaDialog>
    <NanaDrawer
      v-model:open="drawerOpen"
      title="Overlay 证据 Drawer"
      side="right"
      :width="320"
      data-agent-id="nana.overlay.evidence.drawer"
    >
      <p>Phase E / X3 business evidence drawer body.</p>
      <template #footer>
        <button
          type="button"
          class="drawer-footer-cancel nana-drawer-cancel"
          data-nana-action="cancel"
          @click="drawerOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="drawer-footer-confirm nana-drawer-confirm"
          data-nana-action="confirm"
        >
          确认
        </button>
      </template>
    </NanaDrawer>
  </div>
</template>
