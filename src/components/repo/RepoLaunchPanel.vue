<script setup lang="ts">
import { LoaderCircle, Play, RefreshCw, Settings, Square, Terminal } from "@lucide/vue";
import type { ProjectLaunchConfig, ProjectLaunchLog, ProjectLaunchStatus } from "../../services/workspace";
import { launchSourceText, launchStatusText, streamLabel } from "../../utils/repoDisplay";

defineProps<{
  loading: boolean;
  launchEditing: boolean;
  hasLaunchCommand: boolean;
  launchConfig: ProjectLaunchConfig | null;
  launchStatus: ProjectLaunchStatus | null;
  launchLogs: readonly ProjectLaunchLog[];
  launchTerminalVisible: boolean;
  launchCommandInput: string;
  launchCwdInput: string;
  actionRunning: boolean;
  launchRunning: boolean;
}>();

defineEmits<{
  refresh: [];
  start: [];
  stop: [];
  toggleTerminal: [];
  editConfig: [];
  "update:launchCommandInput": [value: string];
  "update:launchCwdInput": [value: string];
  save: [];
  cancel: [];
  hideTerminal: [];
}>();
</script>

<template>
  <section class="launch-panel card">
    <div class="section-toolbar section-toolbar--compact">
      <div>
        <h2>
          快速启动
          <LoaderCircle v-if="loading" :size="13" aria-hidden="true" class="card-title-loader" />
        </h2>
        <p class="muted">
          {{ hasLaunchCommand ? launchStatusText(launchStatus) : "未识别启动脚本" }}
          <template v-if="hasLaunchCommand"> · {{ launchSourceText(launchConfig) }}</template>
        </p>
      </div>
      <button type="button" class="ghost" :disabled="loading" @click="$emit('refresh')">
        <RefreshCw :size="14" aria-hidden="true" />
        刷新状态
      </button>
    </div>

    <div class="launch-actions">
      <button type="button" class="primary" :disabled="actionRunning || !hasLaunchCommand || launchRunning" @click="$emit('start')">
        <Play :size="14" aria-hidden="true" />
        运行
      </button>
      <button type="button" class="ghost" :disabled="actionRunning || !launchRunning" @click="$emit('stop')">
        <Square :size="14" aria-hidden="true" />
        停止
      </button>
      <button type="button" class="ghost" @click="$emit('toggleTerminal')">
        <Terminal :size="14" aria-hidden="true" />
        终端
      </button>
      <button type="button" class="ghost" @click="$emit('editConfig')">
        <Settings :size="14" aria-hidden="true" />
        启动配置
      </button>
    </div>

    <div v-if="launchEditing" class="launch-form">
      <label>
        <span>命令</span>
        <input
          :value="launchCommandInput"
          type="text"
          placeholder="例如 yarn tauri:dev"
          @input="$emit('update:launchCommandInput', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>工作目录</span>
        <input
          :value="launchCwdInput"
          type="text"
          placeholder="留空使用仓库根目录"
          @input="$emit('update:launchCwdInput', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="toolbar">
        <button type="button" class="primary" :disabled="!launchCommandInput.trim() || actionRunning" @click="$emit('save')">
          保存配置
        </button>
        <button type="button" class="ghost" @click="$emit('cancel')">取消</button>
      </div>
    </div>
    <div v-else class="launch-command">
      <code>{{ launchConfig?.command || "暂无启动命令，请手动配置。" }}</code>
      <span v-if="launchConfig?.cwd">cwd: {{ launchConfig.cwd }}</span>
    </div>

    <p v-if="launchStatus?.error" class="error-line">{{ launchStatus.error }}</p>

    <div v-if="launchTerminalVisible" class="launch-terminal" aria-label="启动终端">
      <div class="launch-terminal__header">
        <span>运行输出</span>
        <button type="button" class="ghost" @click="$emit('hideTerminal')">隐藏</button>
      </div>
      <div class="launch-terminal__body">
        <p v-if="!launchLogs.length" class="muted">暂无输出。</p>
        <pre v-else><code><span
          v-for="entry in launchLogs"
          :key="entry.index"
          :class="`launch-log launch-log--${entry.stream}`"
        >[{{ streamLabel(entry.stream) }}] {{ entry.line }}
</span></code></pre>
      </div>
    </div>
  </section>
</template>
