<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CircleDot, Command, GitPullRequest, LoaderCircle, Package, Plus, RefreshCw, RotateCw, Search, Settings2 } from "@lucide/vue";
import { useShellRepoActions, type ShellPaletteCommand } from "../composables/useShellRepoActions";
import { useWorkspace } from "../composables/useWorkspace";
import { repoProjectCreateRoute, repoProjectRoute, repoRoute } from "../utils/repoRoutes";
import {
  COMMAND_PALETTE_SHORTCUT_ACTION,
  matchesCommandPaletteShortcut,
  resolveKeyboardShortcut,
} from "../utils/keyboardShortcuts";

type PaletteCommand = ShellPaletteCommand;

const props = defineProps<{
  searchOpen: boolean;
}>();

const emit = defineEmits<{
  toggleSearch: [];
}>();

const workspace = useWorkspace();
const shellActions = useShellRepoActions();
const route = useRoute();
const router = useRouter();
const open = ref(false);
const query = ref("");
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const currentRepoId = computed(() => {
  const value = route.params.repoId;
  return typeof value === "string" && value ? value : null;
});

const commands = computed<PaletteCommand[]>(() => {
  const repoId = currentRepoId.value;
  const items: PaletteCommand[] = [
    {
      id: "search",
      label: props.searchOpen ? "关闭仓库搜索" : "打开仓库搜索",
      detail: "侧栏仓库和远端仓库搜索",
      keywords: "search repo repository",
      icon: Search,
      run: () => emit("toggleSearch"),
    },
    {
      id: "home",
      label: "回到项目总览",
      detail: "打开工作区首页",
      keywords: "home overview",
      icon: Command,
      run: () => router.push("/"),
    },
    {
      id: "settings",
      label: "打开设置",
      detail: "主题、仓库和授权设置",
      keywords: "settings config preferences",
      icon: Settings2,
      run: () => router.push("/settings"),
    },
    {
      id: "refresh",
      label: "刷新仓库状态",
      detail: "重新读取本地仓库摘要",
      keywords: "refresh status git",
      icon: RefreshCw,
      run: () => workspace.refreshRepos(),
      disabled: workspace.state.loading || workspace.state.scanning,
    },
    {
      id: "discover",
      label: "发现新仓库",
      detail: "扫描工作区中的 Git 仓库",
      keywords: "discover scan repo",
      icon: LoaderCircle,
      run: () => workspace.discoverRepos(),
      disabled: workspace.state.scanning,
    },
    {
      id: "sync",
      label: "同步全部待处理仓库",
      detail: "执行批量 pull/push 同步链路",
      keywords: "sync pull push github",
      icon: RotateCw,
      run: () => workspace.syncAll("stash"),
      disabled: workspace.state.bulkRunning,
    },
  ];
  items.push(...(shellActions?.homeRepoCreateCommands.value ?? []));
  if (repoId) {
    items.push(
      {
        id: "repo",
        label: "打开当前仓库概览",
        detail: repoId,
        keywords: "repo project readme",
        icon: Command,
        run: () => router.push(repoRoute(repoId)),
      },
      {
        id: "issues",
        label: "当前仓库 Issues",
        detail: "打开 issue 列表和筛选",
        keywords: "github issues issue",
        icon: CircleDot,
        run: () => router.push(repoProjectRoute(repoId, "issues")),
      },
      {
        id: "create-issue",
        label: "创建当前仓库 Issue",
        detail: "打开新建 Issue 表单",
        keywords: "github issues issue create new",
        icon: Plus,
        run: () => router.push(repoProjectCreateRoute(repoId, "issue")),
      },
      {
        id: "pulls",
        label: "当前仓库 Pull Requests",
        detail: "打开 PR 列表、checks 和合并操作",
        keywords: "github pull request pr review",
        icon: GitPullRequest,
        run: () => router.push(repoProjectRoute(repoId, "pulls")),
      },
      {
        id: "create-pull",
        label: "创建当前仓库 Pull Request",
        detail: "打开新建 PR 表单",
        keywords: "github pull request pr create new",
        icon: GitPullRequest,
        run: () => router.push(repoProjectCreateRoute(repoId, "pull")),
      },
      {
        id: "actions",
        label: "当前仓库 Actions",
        detail: "打开 workflow 运行和失败诊断",
        keywords: "github actions workflow ci",
        icon: RotateCw,
        run: () => router.push(repoProjectRoute(repoId, "actions")),
      },
      {
        id: "release",
        label: "当前仓库 Release",
        detail: "打开 release 和产物管理",
        keywords: "github release artifact publish",
        icon: Package,
        run: () => router.push(repoProjectRoute(repoId, "release")),
      },
      {
        id: "create-release",
        label: "创建当前仓库 Release",
        detail: "打开新建 Release 表单",
        keywords: "github release artifact publish create new",
        icon: Plus,
        run: () => router.push(repoProjectCreateRoute(repoId, "release")),
      },
    );
  }
  return items;
});

const filteredCommands = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result = terms.length
    ? commands.value.filter((item) => {
      const haystack = `${item.label} ${item.detail} ${item.keywords}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    : commands.value;
  return result.slice(0, 10);
});

function close() {
  open.value = false;
  query.value = "";
  activeIndex.value = 0;
}

async function show() {
  open.value = true;
  activeIndex.value = 0;
  await nextTick();
  inputRef.value?.focus();
}

async function runCommand(command: PaletteCommand) {
  if (command.disabled) return;
  await command.run();
  close();
}

function onKeydown(event: KeyboardEvent) {
  const commandPaletteShortcut = resolveKeyboardShortcut(
    workspace.state.settings?.keyboardShortcuts,
    COMMAND_PALETTE_SHORTCUT_ACTION,
  );
  if (matchesCommandPaletteShortcut(event, commandPaletteShortcut)) {
    event.preventDefault();
    void show();
    return;
  }
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, filteredCommands.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const command = filteredCommands.value[activeIndex.value];
    if (command) void runCommand(command);
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="command-palette"
      data-agent-id="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="命令入口"
      @pointerdown.self="close"
    >
      <section class="command-palette__panel" data-agent-id="command-palette.panel">
        <div class="command-palette__input">
          <Search :size="16" aria-hidden="true" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            data-agent-id="command-palette.input"
            placeholder="输入命令或 GitHub 操作"
          />
        </div>
        <div class="command-palette__list" role="listbox" aria-label="命令列表">
          <button
            v-for="(command, index) in filteredCommands"
            :key="command.id"
            type="button"
            role="option"
            class="command-palette__item"
            :data-agent-id="`command-palette.command.${command.id}`"
            :class="{ 'is-active': index === activeIndex }"
            :disabled="command.disabled"
            @mouseenter="activeIndex = index"
            @click="runCommand(command)"
          >
            <component :is="command.icon" :size="15" aria-hidden="true" />
            <span>
              <strong>{{ command.label }}</strong>
              <small>{{ command.detail }}</small>
            </span>
          </button>
          <p v-if="!filteredCommands.length" class="command-palette__empty">没有匹配命令。</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.command-palette {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: start center;
  padding-top: 72px;
  background: rgba(0, 0, 0, 0.35);
}

.command-palette__panel {
  display: grid;
  gap: 8px;
  width: min(560px, calc(100vw - 32px));
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.command-palette__input {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.command-palette__input input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}

.command-palette__list {
  display: grid;
  gap: 4px;
}

.command-palette__item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
}

.command-palette__item.is-active,
.command-palette__item:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.command-palette__item:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.command-palette__item span {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.command-palette__item strong,
.command-palette__item small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-palette__item strong {
  font-size: 13px;
}

.command-palette__item small,
.command-palette__empty {
  color: var(--text-muted);
  font-size: 12px;
}

.command-palette__empty {
  margin: 8px;
}
</style>
