<script setup lang="ts">
import { AnsiUp } from "ansi_up";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ProjectLaunchLog } from "../../services/workspace/types";

const props = defineProps<{
  launchLogs: readonly ProjectLaunchLog[];
  launchError?: string | null;
}>();

const ansiUp = new AnsiUp();
const terminalBody = ref<HTMLElement | null>(null);

const terminalHtml = computed(() => renderTerminalHtml(props.launchLogs));

type TerminalLine = {
  stream: ProjectLaunchLog["stream"];
  line: string;
  dynamic: boolean;
};

onMounted(() => {
  void scrollTerminalToEnd();
});

watch(() => props.launchLogs.length, () => {
  void scrollTerminalToEnd();
});

function renderTerminalHtml(logs: readonly ProjectLaunchLog[]) {
  return buildTerminalLines(logs)
    .map((entry) => `<span class="launch-log launch-log--${entry.stream}">${ansiUp.ansi_to_html(entry.line)}</span>`)
    .join("\n");
}

function buildTerminalLines(logs: readonly ProjectLaunchLog[]) {
  const lines: TerminalLine[] = [];
  for (const entry of logs) {
    applyTerminalLog(lines, entry);
  }
  return lines;
}

function applyTerminalLog(lines: TerminalLine[], entry: ProjectLaunchLog) {
  let mode: ProjectLaunchLog["writeMode"] = entry.writeMode ?? "append";
  let segment = "";
  const normalized = entry.line.replace(/\r\n/g, "\n");
  for (const char of normalized) {
    if (char === "\r") {
      applyTerminalSegment(lines, entry.stream, "replace", segment);
      segment = "";
      mode = "replace";
    } else if (char === "\n") {
      applyTerminalSegment(lines, entry.stream, "append", segment);
      segment = "";
      mode = "append";
    } else {
      segment += char;
    }
  }
  if (segment || !normalized.length) {
    applyTerminalSegment(lines, entry.stream, mode, segment);
  }
}

function applyTerminalSegment(
  lines: TerminalLine[],
  stream: ProjectLaunchLog["stream"],
  mode: ProjectLaunchLog["writeMode"],
  line: string,
) {
  const last = lines[lines.length - 1];
  if (mode === "replace") {
    if (last?.dynamic && last.stream === stream) {
      last.line = line;
    } else {
      lines.push({ stream, line, dynamic: true });
    }
    return;
  }

  if (last?.dynamic && last.stream === stream) {
    last.line = line;
    last.dynamic = false;
  } else {
    lines.push({ stream, line, dynamic: false });
  }
}

async function scrollTerminalToEnd() {
  await nextTick();
  const body = terminalBody.value;
  if (!body) return;
  body.scrollTop = body.scrollHeight;
}
</script>

<template>
  <section class="project-terminal-card">
    <div ref="terminalBody" class="project-terminal__body" aria-label="启动终端">
      <div v-if="launchError" class="project-terminal__line project-terminal__line--error">{{ launchError }}</div>
      <pre v-if="launchLogs.length" class="project-terminal__output"><code v-html="terminalHtml"></code></pre>
      <div v-else class="project-terminal__line project-terminal__line--muted">暂无输出。</div>
    </div>
  </section>
</template>

<style scoped>
.project-terminal-card {
  display: grid;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
}

.project-terminal__body {
  display: grid;
  align-content: start;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 14px 16px;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.project-terminal__line--error {
  color: var(--err);
}

.project-terminal__line--muted {
  color: var(--text-muted);
}

.project-terminal__output {
  max-height: none;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.project-terminal__output code {
  font: inherit;
}

:deep(.launch-log) {
  display: inline;
}

:deep(.launch-log--stderr) {
  color: var(--err);
}

:deep(.launch-log--system) {
  color: var(--text-muted);
}
</style>
