<script setup lang="ts">
/**
 * Nana Repo skeleton — real @lilia/ui chrome + readme/files panel subset
 * (not full Tauri RepoDetail workbench).
 */
import { FileText, FolderGit2, FolderTree, GitBranch, RefreshCw } from "@lucide/vue";
import { UiButton, UiCard } from "@lilia/ui";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NanaTabs } from "@nanaui/nanavue-components";
import { useWorkspace } from "../composables/useWorkspace";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspace();

const repoId = computed(() => String(route.params.repoId || "repo-1"));
const repo = computed(() => {
  const list = Array.isArray(workspace.state?.repos) ? workspace.state.repos : [];
  return (
    list.find((r: { id?: string }) => r?.id === repoId.value) ||
    list[0] || {
      id: repoId.value,
      name: "NanaUI",
      fullName: "nana-demo/NanaUI",
      defaultBranch: "main",
      language: "Rust",
      path: "/tmp/demo-workspace/NanaUI",
    }
  );
});

const title = computed(() => repo.value?.fullName || repo.value?.name || repoId.value);
const branch = computed(() => repo.value?.defaultBranch || "main");
const language = computed(() => repo.value?.language || "—");
const localPath = computed(() => repo.value?.path || "—");

type RepoTab = "overview" | "readme" | "files";
const activeTab = ref<RepoTab>("readme");

const tabs: { key: RepoTab; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "readme", label: "README" },
  { key: "files", label: "文件" },
];

const readmeTitle = computed(() => `# ${repo.value?.name || "NanaUI"}`);
const readmeBody = computed(
  () =>
    [
      "Nana Vue backend · QuickJS XOR V8 · no WebView.",
      "",
      "## Status",
      `- Branch \`${branch.value}\``,
      `- Language · ${language.value}`,
      `- Local · ${localPath.value}`,
      "",
      "This README panel is the Nana RepoDetail subset (mock).",
    ].join("\n"),
);

const fileEntries = computed(() => [
  { path: "README.md", kind: "file" as const },
  { path: "Cargo.toml", kind: "file" as const },
  { path: "crates/", kind: "dir" as const },
  { path: "packages/nanavue-components/", kind: "dir" as const },
  { path: "examples/lilia-github-nana/", kind: "dir" as const },
]);

const selectedFile = ref("README.md");

function selectTab(key: RepoTab) {
  activeTab.value = key;
}

function onSelectTab(key: unknown) {
  if (key === "overview" || key === "readme" || key === "files") {
    selectTab(key);
  }
}
</script>

<template>
  <section class="nana-repo" data-agent-id="repo.page" data-page="repo" :data-tab="activeTab">
    <header class="nana-repo__toolbar" data-agent-id="repo.toolbar">
      <div class="nana-repo__title-row">
        <FolderGit2 :size="18" />
        <h1 class="nana-repo__title">{{ title }}</h1>
      </div>
      <div class="nana-repo__actions">
        <UiButton
          variant="ghost"
          size="sm"
          agent-id="repo.refresh"
          @click="workspace.refreshRepos?.()"
        >
          <RefreshCw :size="14" />
          刷新
        </UiButton>
        <UiButton
          variant="secondary"
          size="sm"
          agent-id="repo.back-home"
          @click="router.push('/')"
        >
          返回总览
        </UiButton>
      </div>
    </header>

    <NanaTabs
      class="nana-repo__tabs"
      aria-label="仓库页签"
      data-agent-id="repo.tabs"
      :model-value="activeTab"
      :options="tabs.map((tab) => ({ key: tab.key, label: tab.label, agentId: `repo.tab.${tab.key}` }))"
      @select="onSelectTab"
    />

    <div v-if="activeTab === 'overview'" class="nana-repo__grid" data-agent-id="repo.panel.overview">
      <UiCard class="nana-repo__card" data-agent-id="repo.status">
        <h2>仓库状态</h2>
        <p class="nana-repo__stat">
          <GitBranch :size="14" />
          <span>{{ branch }}</span>
        </p>
        <p>语言 · {{ language }}</p>
        <p>本地 · {{ localPath }}</p>
      </UiCard>
      <UiCard class="nana-repo__card" data-agent-id="repo.summary">
        <h2>概览卡片</h2>
        <ul>
          <li>未提交变更 · 0</li>
          <li>领先 / 落后 · 0 / 0</li>
          <li>同步问题 · 无</li>
        </ul>
      </UiCard>
    </div>

    <div v-else-if="activeTab === 'readme'" class="nana-repo__panel" data-agent-id="repo.panel.readme">
      <UiCard class="nana-repo__card nana-repo__readme" data-agent-id="repo.readme">
        <div class="nana-repo__readme-head">
          <FileText :size="16" />
          <h2>README.md</h2>
        </div>
        <h3 class="nana-repo__readme-title">{{ readmeTitle }}</h3>
        <pre class="nana-repo__readme-body">{{ readmeBody }}</pre>
      </UiCard>
    </div>

    <div v-else class="nana-repo__panel nana-repo__files" data-agent-id="repo.panel.files">
      <UiCard class="nana-repo__card nana-repo__files-tree" data-agent-id="repo.files.tree">
        <div class="nana-repo__readme-head">
          <FolderTree :size="16" />
          <h2>文件</h2>
        </div>
        <ul class="nana-repo__file-list">
          <li v-for="entry in fileEntries" :key="entry.path">
            <button
              type="button"
              class="nana-repo__file"
              :class="{ 'is-active': selectedFile === entry.path }"
              :data-agent-id="`repo.file.${entry.path}`"
              @click="selectedFile = entry.path"
            >
              <span class="nana-repo__file-kind">{{ entry.kind === "dir" ? "dir" : "file" }}</span>
              <span>{{ entry.path }}</span>
            </button>
          </li>
        </ul>
      </UiCard>
      <UiCard class="nana-repo__card nana-repo__files-preview" data-agent-id="repo.files.preview">
        <h2>预览 · {{ selectedFile }}</h2>
        <p v-if="selectedFile === 'README.md'" class="nana-repo__hint">
          {{ readmeTitle }} — 切换到 README 页签查看完整 mock 内容。
        </p>
        <p v-else class="nana-repo__hint">
          Mock file preview for <code>{{ selectedFile }}</code>（完整 Diff / blob 仍走 Tauri）。
        </p>
      </UiCard>
    </div>
  </section>
</template>

<style scoped>
.nana-repo {
  min-width: 0;
  padding: 16px;
  /* Flex column shell — trackless `display:grid` was collapsing under the
     region scrollport in Nana iced-view (empty main paint). Overview/files
     keep honest 1D grid tracks below. */
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.nana-repo__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.nana-repo__title-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text, #1a1d23);
}

.nana-repo__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.nana-repo__actions {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.nana-repo__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-soft, #e2e6ee);
  padding-bottom: 4px;
}

.nana-repo__tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-muted, #5c6575);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
}

.nana-repo__tab.is-active {
  background: var(--bg-subtle, #eef0f4);
  color: var(--text, #1a1d23);
  font-weight: 600;
}

/* Honest fixed-count tracks: Nana 1D grid supports repeat(N)/minmax, not
   auto-fit/fill (those remain explicit Unsupported — never silent drop).
   Overview + files panels each have exactly two cards. */
.nana-repo__grid,
.nana-repo__files {
  display: grid;
  grid-template-columns: repeat(2, minmax(240px, 1fr));
  gap: 12px;
}

.nana-repo__panel {
  min-width: 0;
}

.nana-repo__card {
  padding: 14px;
}

.nana-repo__card h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #1a1d23);
}

.nana-repo__card p,
.nana-repo__card li {
  margin: 0;
  color: var(--text-muted, #5c6575);
  font-size: 12px;
  line-height: 1.5;
}

.nana-repo__card ul {
  margin: 0;
  padding-left: 16px;
}

.nana-repo__stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px !important;
  color: var(--text, #1a1d23) !important;
}

.nana-repo__hint {
  margin-top: 10px !important;
}

.nana-repo__readme-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text, #1a1d23);
}

.nana-repo__readme-head h2 {
  margin: 0;
}

.nana-repo__readme-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text, #1a1d23);
}

.nana-repo__readme-body {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text, #1a1d23);
  background: var(--bg-subtle, #eef0f4);
  border-radius: var(--radius-sm, 6px);
  padding: 12px;
}

.nana-repo__file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.nana-repo__file {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  color: var(--text, #1a1d23);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.nana-repo__file.is-active {
  background: var(--accent-soft, #dbe4ff);
  color: var(--accent-strong, #2f54d6);
  font-weight: 600;
}

.nana-repo__file-kind {
  min-width: 28px;
  color: var(--text-faint, #8b93a3);
  font-size: 10px;
  text-transform: uppercase;
}
</style>
