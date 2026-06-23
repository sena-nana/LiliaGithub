<script setup lang="ts">
import { ExternalLink } from "@lucide/vue";
import type { RepoFileBrowser } from "./useRepoFileBrowser";
import MarkdownReadme from "./MarkdownReadme.vue";

const props = defineProps<{
  browser: RepoFileBrowser;
}>();

const {
  absolutePreviewPath,
  isCodePreview,
  knownMarkdownPaths,
  markdownReadme,
  openPreviewFile,
  openPreviewLink,
  preview,
  previewDescription,
  previewError,
  previewLoading,
  previewTitle,
  repoPath,
  textPreviewLines,
} = props.browser;

function bindMarkdownReadme(value: unknown) {
  markdownReadme.value = value as typeof markdownReadme.value;
}
</script>

<template>
  <main class="files-main" :aria-label="previewTitle">
    <div class="files-main__head">
      <div class="files-main__title-line">
        <strong>{{ previewTitle }}</strong>
        <span v-if="previewDescription" class="files-main__meta">{{ previewDescription }}</span>
      </div>
      <button
        v-if="preview && absolutePreviewPath"
        type="button"
        class="ghost files-main__open"
        aria-label="打开文件"
        title="打开文件"
        @click="openPreviewFile"
      >
        <ExternalLink :size="14" aria-hidden="true" />
      </button>
    </div>

    <p v-if="previewError" class="error-line files-main__empty">{{ previewError }}</p>
    <p v-else-if="previewLoading" class="muted files-main__empty">正在读取文件内容。</p>
    <p v-else-if="!preview" class="muted files-main__empty">选择一个文件查看内容。</p>
    <pre
      v-else-if="preview.previewKind === 'text'"
      class="files-main__code"
      :class="isCodePreview ? 'files-main__code--numbered' : 'files-main__code--plain'"
    ><code><span
      v-for="line in textPreviewLines"
      :key="`${preview.path}:${line.index}`"
      class="files-main__code-line"
      :class="{ 'files-main__code-line--numbered': isCodePreview }"
    ><span v-if="isCodePreview" class="files-main__line-number" aria-hidden="true">{{ line.lineNumber }}</span><span
      class="files-main__code-content"
      :class="{ 'files-main__code-content--numbered': isCodePreview }"
    ><span
        v-for="(token, tokenIndex) in line.tokens"
        :key="`${line.index}:${tokenIndex}:${token.type}:${token.text}`"
        class="diff-code__token"
        :class="`diff-code__token--${token.type}`"
      >{{ token.text }}</span></span>{{ !isCodePreview && line.index < textPreviewLines.length - 1 ? "\n" : "" }}</span></code></pre>
    <MarkdownReadme
      v-else-if="preview.previewKind === 'markdown' && preview.content"
      :ref="bindMarkdownReadme"
      :content="preview.content"
      :images="preview.images"
      :repo-root-path="repoPath"
      :current-readme-path="preview.path"
      :readme-paths="knownMarkdownPaths"
      @open-link="openPreviewLink"
    />
    <div v-else-if="preview.previewKind === 'image' && preview.dataUrl" class="files-main__image-wrap">
      <img class="files-main__image" :src="preview.dataUrl" :alt="preview.name" />
    </div>
    <div v-else class="files-main__unsupported">
      <strong>{{ preview.previewKind === "tooLarge" ? "文件过大" : "暂不支持预览" }}</strong>
      <p>{{ preview.path }}</p>
    </div>
  </main>
</template>

<style scoped>
.files-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
}

.files-main__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-soft);
}

.files-main__head strong {
  display: block;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.files-main__title-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.files-main__meta {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.files-main__open {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  line-height: 1;
}

.files-main__empty,
.files-main__unsupported {
  padding: 16px;
}

.files-main__unsupported strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text);
}

.files-main__unsupported p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.files-main__code {
  margin: 0;
  overflow: auto;
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}

.files-main__code code {
  font: inherit;
}

.files-main__code--plain {
  padding: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.files-main__code--numbered {
  padding: 12px 0;
  white-space: pre;
  overflow-wrap: normal;
}

.files-main__code--numbered code {
  display: block;
  min-width: max-content;
}

.files-main__code-line {
  display: block;
  min-width: 0;
}

.files-main__code-line--numbered {
  display: flex;
  min-width: max-content;
}

.files-main__line-number {
  position: sticky;
  left: 0;
  flex: 0 0 44px;
  padding: 0 10px 0 12px;
  border-right: 1px solid var(--border-soft);
  background: var(--bg-elev);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

.files-main__code-content--numbered {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0 16px 0 12px;
}

.files-main :deep(.readme-render) {
  padding: 16px;
  overflow: auto;
  height: 100%;
}

.files-main__image-wrap {
  display: grid;
  place-items: start center;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  background: var(--bg-subtle);
}

.files-main__image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  background: white;
}
</style>
