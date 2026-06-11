<script setup lang="ts">
import { Check, TriangleAlert } from "@lucide/vue";
import type { RepoConflictFile, RepoConflictState } from "../../services/workspace";
import { conflictStatusText, conflictStatusTone } from "../../utils/repoDisplay";

defineProps<{
  conflictOperationText: string;
  conflictSummaryText: string;
  conflictContinueText: string;
  conflictAbortText: string;
  conflictFiles: readonly RepoConflictFile[];
  conflictOperationActive: boolean;
  conflicts: RepoConflictState;
  focusedConflict: RepoConflictFile | null;
  conflictChoices: Record<string, "ours" | "theirs">;
  conflictSelectedCount: number;
  conflictAcceptConfirm: "ours" | "theirs" | null;
  canContinueConflictOperation: boolean;
  canResolveSelectedConflict: boolean;
  supportedConflictOperation: boolean;
  actionRunning: boolean;
}>();

defineEmits<{
  continueConflict: [];
  abortConflict: [];
  focusConflict: [path: string];
  pickConflictHunk: [hunkId: string, side: "ours" | "theirs"];
  resolveSelectedConflict: [];
  acceptConflict: [side: "ours" | "theirs"];
  markConflictResolved: [];
  openConflictFolder: [];
}>();
</script>

<template>
  <section class="repo-panel">
    <div class="section-toolbar section-toolbar--compact">
      <div class="repo-panel__title">
        <h2>{{ conflictOperationText }}</h2>
        <p class="muted">{{ conflictSummaryText }}</p>
      </div>
      <div class="toolbar">
        <button
          type="button"
          class="primary"
          :disabled="actionRunning || !canContinueConflictOperation"
          @click="$emit('continueConflict')"
        >
          <Check :size="14" aria-hidden="true" />
          {{ conflictContinueText }}
        </button>
        <button
          type="button"
          class="ghost danger"
          :disabled="actionRunning || !supportedConflictOperation"
          @click="$emit('abortConflict')"
        >
          <TriangleAlert :size="14" aria-hidden="true" />
          {{ conflictAbortText }}
        </button>
      </div>
    </div>

    <p v-if="!conflictFiles.length && conflictOperationActive" class="muted repo-empty">冲突文件已处理，可继续当前操作。</p>
    <p v-else-if="!conflictFiles.length" class="muted repo-empty">当前没有需要处理的冲突。</p>
    <div v-else class="conflict-flow">
      <div class="conflict-workspace">
        <div class="conflict-list" role="list" aria-label="冲突文件列表">
          <button
            v-for="file in conflictFiles"
            :key="file.path"
            type="button"
            class="conflict-row"
            :class="{ 'is-focused': focusedConflict?.path === file.path }"
            @click="$emit('focusConflict', file.path)"
          >
            <span class="conflict-row__path">
              <strong>{{ file.path }}</strong>
              <small>{{ file.status }} · {{ conflictStatusText(file) }}</small>
            </span>
            <span class="change-badge" :class="conflictStatusTone(file)">
              {{ file.resolved ? "已解决" : "待处理" }}
            </span>
          </button>
        </div>

        <section class="conflict-editor" aria-label="冲突分段处理">
          <div class="section-toolbar section-toolbar--compact">
            <div class="repo-panel__title">
              <h2>分段处理</h2>
              <p class="muted">{{ focusedConflict?.path ?? "选择左侧冲突文件" }}</p>
            </div>
          </div>
          <p v-if="!focusedConflict" class="muted diff-preview__empty">没有选中的冲突文件。</p>
          <p v-else-if="focusedConflict.binary" class="muted diff-preview__empty">该文件无法解析为文本冲突，请使用文件级处理或外部编辑。</p>
          <p v-else-if="!focusedConflict.hunks.length" class="muted diff-preview__empty">该文件没有可分段解析的 marker，请使用文件级处理或外部编辑。</p>
          <div v-else class="conflict-hunk-list">
            <article v-for="hunk in focusedConflict.hunks" :key="hunk.id" class="conflict-hunk">
              <header class="conflict-hunk__header">
                <strong>{{ hunk.id }}</strong>
                <span>第 {{ hunk.startLine }}-{{ hunk.endLine }} 行</span>
              </header>
              <div class="conflict-hunk__columns">
                <section class="conflict-side" :class="{ 'is-selected': conflictChoices[hunk.id] === 'ours' }">
                  <div class="conflict-side__header">
                    <strong>{{ hunk.oursLabel }}</strong>
                    <button type="button" class="ghost" @click="$emit('pickConflictHunk', hunk.id, 'ours')">采用此段</button>
                  </div>
                  <pre><code>{{ hunk.oursLines.join("\n") || " " }}</code></pre>
                </section>
                <section class="conflict-side" :class="{ 'is-selected': conflictChoices[hunk.id] === 'theirs' }">
                  <div class="conflict-side__header">
                    <strong>{{ hunk.theirsLabel }}</strong>
                    <button type="button" class="ghost" @click="$emit('pickConflictHunk', hunk.id, 'theirs')">采用此段</button>
                  </div>
                  <pre><code>{{ hunk.theirsLines.join("\n") || " " }}</code></pre>
                </section>
              </div>
            </article>
          </div>
        </section>

        <aside class="conflict-sidepanel" aria-label="冲突处理操作">
          <div class="conflict-sidepanel__card">
            <div class="section-toolbar section-toolbar--compact">
              <div class="repo-panel__title">
                <h2>当前文件</h2>
                <p class="muted">{{ focusedConflict?.path ?? "未选择" }}</p>
              </div>
            </div>
            <dl class="side-kv">
              <div>
                <dt>冲突类型</dt>
                <dd>{{ conflicts.operation }}</dd>
              </div>
              <div>
                <dt>处理进度</dt>
                <dd>{{ conflictSummaryText }}</dd>
              </div>
              <div>
                <dt>已选分段</dt>
                <dd>{{ conflictSelectedCount }}</dd>
              </div>
            </dl>
            <div class="conflict-actions">
              <button type="button" class="primary" :disabled="!canResolveSelectedConflict || actionRunning" @click="$emit('resolveSelectedConflict')">
                解决并暂存
              </button>
              <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="$emit('acceptConflict', 'ours')">
                {{ conflictAcceptConfirm === "ours" ? "确认整文件采用 ours 并暂存" : "整文件采用 ours" }}
              </button>
              <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="$emit('acceptConflict', 'theirs')">
                {{ conflictAcceptConfirm === "theirs" ? "确认整文件采用 theirs 并暂存" : "整文件采用 theirs" }}
              </button>
              <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="$emit('markConflictResolved')">
                外部修改后标记解决
              </button>
              <button type="button" class="ghost" :disabled="!focusedConflict || actionRunning" @click="$emit('openConflictFolder')">
                打开文件
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>
