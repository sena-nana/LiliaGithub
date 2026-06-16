<script setup lang="ts">
import { computed } from "vue";
import type { CommitDiffHunk, CommitDiffLine } from "../../services/workspace";
import {
  inferDiffCodeLanguage,
  tokenizeDiffCodeLine,
  type DiffCodeToken,
} from "../../utils/diffCode";

type DiffCodeMode = "hunks" | "raw";
type RawDiffLineKind = "added" | "deleted" | "hunk" | "meta" | "context";

const props = defineProps<{
  filePath: string;
  hunks?: readonly CommitDiffHunk[];
  patch?: string;
  mode: DiffCodeMode;
  fill?: boolean;
}>();

const language = computed(() => inferDiffCodeLanguage(props.filePath));
const rawLines = computed(() => parseRawDiffLines(props.patch ?? ""));

function tokensFor(line: string): DiffCodeToken[] {
  return tokenizeDiffCodeLine(line, language.value);
}

function lineKey(hunk: CommitDiffHunk, line: CommitDiffLine, index: number): string {
  return `${hunk.header}:${line.oldLine ?? ""}:${line.newLine ?? ""}:${index}`;
}

function parseRawDiffLines(patch: string) {
  return patch.split("\n").map((line, index) => {
    const kind = rawDiffLineKind(line);
    const isCodeLine = kind === "added" || kind === "deleted" || kind === "context";
    const prefix = isCodeLine && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
      ? line.slice(0, 1)
      : "";
    const content = prefix ? line.slice(1) : line;

    return {
      index,
      kind,
      prefix,
      tokens: isCodeLine ? tokensFor(content) : [{ type: "plain" as const, text: line }],
    };
  });
}

function rawDiffLineKind(line: string): RawDiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "meta";
  }
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "deleted";
  return "context";
}
</script>

<template>
  <div v-if="mode === 'hunks'" class="diff-code diff-code--hunks">
    <template v-for="hunk in hunks" :key="`${filePath}:${hunk.header}`">
      <div class="diff-code__hunk" role="row">
        <span class="diff-code__hunk-header">{{ hunk.header }}</span>
      </div>
      <div
        v-for="(line, index) in hunk.lines"
        :key="lineKey(hunk, line, index)"
        class="diff-code__line"
        :class="`is-${line.kind}`"
        role="row"
      >
        <span class="diff-code__number">{{ line.oldLine ?? "" }}</span>
        <span class="diff-code__number">{{ line.newLine ?? "" }}</span>
        <span class="diff-code__content">
          <span
            v-for="(token, tokenIndex) in tokensFor(line.content || ' ')"
            :key="`${tokenIndex}:${token.type}:${token.text}`"
            class="diff-code__token"
            :class="`diff-code__token--${token.type}`"
          >{{ token.text }}</span>
        </span>
      </div>
    </template>
  </div>

  <pre v-else class="diff-code diff-code--raw" :class="{ 'diff-code--fill': fill }"><code><span
    v-for="line in rawLines"
    :key="line.index"
    class="diff-code__raw-line"
    :class="`is-${line.kind}`"
  ><span v-if="line.prefix" class="diff-code__raw-prefix">{{ line.prefix }}</span><span
      v-for="(token, tokenIndex) in line.tokens"
      :key="`${tokenIndex}:${token.type}:${token.text}`"
      class="diff-code__token"
      :class="`diff-code__token--${token.type}`"
    >{{ token.text }}</span>{{ line.index < rawLines.length - 1 ? "\n" : "" }}</span></code></pre>
</template>

<style scoped>
.diff-code {
  font-family: var(--font-mono);
  font-size: 12px;
}

.diff-code--hunks {
  display: grid;
  overflow-x: auto;
}

.diff-code__hunk,
.diff-code__line {
  display: grid;
  grid-template-columns: 34px 34px max-content;
  width: max-content;
  min-width: 100%;
  min-height: 19px;
}

.diff-code__hunk {
  align-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border-top: 1px solid var(--border-soft);
}

.diff-code__hunk:first-child {
  border-top: 0;
}

.diff-code__hunk-header {
  grid-column: 1 / -1;
  padding: 2px 8px;
  white-space: pre;
}

.diff-code__line {
  line-height: 1.25;
  white-space: pre;
}

.diff-code__line.is-added,
.diff-code__raw-line.is-added {
  background: color-mix(in srgb, var(--ok) 10%, transparent);
}

.diff-code__line.is-deleted,
.diff-code__raw-line.is-deleted {
  background: color-mix(in srgb, var(--err) 10%, transparent);
}

.diff-code__line.is-meta,
.diff-code__raw-line.is-meta,
.diff-code__raw-line.is-hunk {
  color: var(--text-muted);
}

.diff-code__raw-line.is-hunk {
  background: var(--accent-soft);
}

.diff-code__number {
  padding: 1px 5px;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
}

.diff-code__content {
  min-width: 0;
  padding: 1px 10px 1px 8px;
  color: var(--text);
}

.diff-code--raw {
  min-width: max-content;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  color: var(--text);
  line-height: 1.45;
  white-space: pre;
}

.diff-code--raw.diff-code--fill {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: 100%;
}

.diff-code--raw code {
  font-family: inherit;
}

.diff-code__raw-line {
  display: block;
  min-width: 100%;
  width: max-content;
  white-space: pre;
}

.diff-code__raw-prefix {
  color: var(--text-muted);
}

.diff-code__token--keyword {
  color: var(--accent-strong);
  font-weight: 600;
}

.diff-code__token--string {
  color: var(--ok);
}

.diff-code__token--comment {
  color: var(--text-muted);
  font-style: italic;
}

.diff-code__token--number {
  color: var(--warn);
}

.diff-code__token--type {
  color: var(--accent);
  font-weight: 600;
}

.diff-code__token--property {
  color: var(--warn);
  font-weight: 600;
}

.diff-code__token--punctuation {
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .diff-code__hunk,
  .diff-code__line {
    grid-template-columns: 30px 30px max-content;
  }
}
</style>
