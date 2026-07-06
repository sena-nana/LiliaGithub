<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  SquareTerminal,
  Trash2,
} from "@lucide/vue";
import type { ContextMenuItem } from "@lilia/ui";
import type { RepoFileBrowser } from "./useRepoFileBrowser";
import type { RepoFileTreeEntry } from "../../services/workspace/types";

const props = defineProps<{
  browser: RepoFileBrowser;
}>();

const {
  canUseLocalFileActions,
  copyTreeEntryAbsolutePath,
  copyTreeEntryPath,
  deleteTreeFile,
  isDirectoryExpanded,
  isDirectoryLoading,
  isTreeItemActive,
  openTreeEntryFolder,
  openTreeEntryTarget,
  openTreeFile,
  repoLocationLabel,
  selectFile,
  toggleDirectory,
  treeError,
  treeLoading,
  visibleEntries,
} = props.browser;

const localOpenTargets = [
  { id: "terminal", label: "在终端打开", icon: SquareTerminal },
  { id: "vscode", label: "用 VSCode 打开", icon: ExternalLink },
  { id: "liliacode", label: "用 LiliaCode 打开", icon: ExternalLink },
] as const;

function fileMenu(entry: RepoFileTreeEntry): () => ContextMenuItem[] {
  return () => {
    if (!canUseLocalFileActions.value) return [];
    const targetActions: ContextMenuItem[] = localOpenTargets.map((target) => ({
      id: `open-${target.id}:${entry.path}`,
      label: target.label,
      icon: target.icon,
      onSelect: () => void openTreeEntryTarget(entry, target.id),
    }));
    const copyActions: ContextMenuItem[] = [
      {
        id: `copy-relative:${entry.path}`,
        label: "复制相对路径",
        icon: Copy,
        onSelect: () => void copyTreeEntryPath(entry),
      },
      {
        id: `copy-absolute:${entry.path}`,
        label: "复制完整路径",
        icon: Copy,
        onSelect: () => void copyTreeEntryAbsolutePath(entry),
      },
    ];
    if (entry.kind === "dir") {
      return [
        {
          id: `open-folder:${entry.path}`,
          label: "打开文件夹",
          icon: FolderOpen,
          onSelect: () => void openTreeEntryFolder(entry),
        },
        ...targetActions,
        ...copyActions,
      ];
    }
    return [
      {
        id: `open:${entry.path}`,
        label: "打开",
        icon: ExternalLink,
        onSelect: () => void openTreeFile(entry.path),
      },
      {
        id: `open-folder:${entry.path}`,
        label: "打开所在文件夹",
        icon: FolderOpen,
        onSelect: () => void openTreeEntryFolder(entry),
      },
      ...targetActions,
      ...copyActions,
      {
        id: `delete:${entry.path}`,
        label: "删除",
        icon: Trash2,
        danger: true,
        confirmLabel: "确认删除？再点一次",
        onSelect: () => void deleteTreeFile(entry.path),
      },
    ];
  };
}
</script>

<template>
  <aside class="files-sidebar" aria-label="仓库文件树">
    <div class="card files-sidebar__card">
      <div v-if="repoLocationLabel" class="files-sidebar__head" :title="repoLocationLabel">{{ repoLocationLabel }}</div>
      <p v-if="treeError" class="error-line files-sidebar__empty">{{ treeError }}</p>
      <p v-else-if="treeLoading" class="muted files-sidebar__empty">正在读取文件树。</p>
      <p v-else-if="!visibleEntries.length" class="muted files-sidebar__empty">当前仓库没有可浏览文件。</p>
      <div v-else class="files-tree" role="tree">
        <button
          v-for="{ entry, depth, badge } in visibleEntries"
          :key="entry.path"
          type="button"
          class="files-tree__item sb-tree__row sb-tree__row--project"
          :data-agent-id="`repo.files.tree.${entry.path}`"
          :class="{ 'is-active': isTreeItemActive(entry) }"
          :style="{ '--tree-indent': `${depth * 10}px` }"
          :aria-expanded="entry.kind === 'dir' ? isDirectoryExpanded(entry.path) : undefined"
          :aria-selected="isTreeItemActive(entry)"
          v-context-menu="fileMenu(entry)"
          @click="entry.kind === 'dir' ? toggleDirectory(entry) : selectFile(entry.path)"
        >
          <span class="files-tree__toggle" aria-hidden="true">
            <ChevronDown
              v-if="entry.kind === 'dir' && isDirectoryExpanded(entry.path)"
              :size="12"
            />
            <ChevronRight
              v-else-if="entry.kind === 'dir' && entry.hasChildren"
              :size="12"
            />
          </span>
          <FolderOpen
            v-if="entry.kind === 'dir' && isDirectoryExpanded(entry.path)"
            :size="12"
            aria-hidden="true"
          />
          <Folder v-else-if="entry.kind === 'dir'" :size="12" aria-hidden="true" />
          <FileImage
            v-else-if="/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)"
            :size="12"
            aria-hidden="true"
          />
          <FileText v-else :size="12" aria-hidden="true" />
          <span class="sb-tree__name">{{ entry.name }}</span>
          <span v-if="badge" class="files-tree__badge" :class="badge.className" :title="badge.label" aria-hidden="true">{{ badge.letter }}</span>
          <span v-if="entry.kind === 'dir' && isDirectoryLoading(entry.path)" class="files-tree__meta">加载中</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.files-sidebar {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.files-sidebar__card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.files-sidebar__head {
  display: flex;
  align-items: center;
  min-width: 0;
  height: var(--repo-sidebar-header-height);
  overflow: hidden;
  padding: 0 var(--repo-sidebar-card-padding);
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-sidebar__empty {
  grid-row: 2;
  margin: 0;
  padding: var(--repo-sidebar-card-padding);
}

.files-tree {
  grid-row: 2;
  display: grid;
  align-content: start;
  min-height: 0;
  overflow: auto;
  padding: var(--repo-sidebar-list-gap);
}

.files-tree__item {
  height: var(--repo-sidebar-control-height);
  padding-left: calc(10px + var(--tree-indent, 0px));
}

.files-tree__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 12px;
  width: 12px;
  min-width: 0;
}

.files-tree__item > svg {
  flex: 0 0 12px;
}

.files-tree__meta,
.files-tree__badge {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-tree__meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 10px;
}

.files-tree__badge {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.files-tree__badge.change-badge--err {
  background: color-mix(in srgb, var(--err) 12%, transparent);
  color: var(--err);
}

.files-tree__badge.change-badge--warn {
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  color: var(--warn);
}

.files-tree__badge.change-badge--accent {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
}

.files-tree__badge.change-badge--ok {
  background: color-mix(in srgb, var(--ok) 12%, transparent);
  color: var(--ok);
}

.files-tree__badge.change-badge--muted {
  background: var(--bg-subtle);
  color: var(--text-muted);
}
</style>
