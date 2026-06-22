<script setup lang="ts">
import { Play, Square } from "@lucide/vue";
import { computed } from "vue";
import type { ProjectLaunchConfig, ProjectLaunchStatus } from "../../services/workspace";

const props = defineProps<{
  loading: boolean;
  launchConfig: ProjectLaunchConfig | null;
  launchStatus: ProjectLaunchStatus | null;
  actionRunning: boolean;
  launchRunning: boolean;
  active: boolean;
}>();

const emit = defineEmits<{
  start: [];
  stop: [];
  openTerminal: [];
}>();

const hasLaunchCommand = computed(() => Boolean(props.launchConfig?.command.trim()));
</script>

<template>
  <section class="launch-panel card" aria-label="快速启动">
    <button
      type="button"
      class="launch-command-button"
      :class="{ 'is-active': active }"
      :disabled="loading"
      @click="emit('openTerminal')"
    >
      <strong>{{ launchConfig?.command || "选择启动指令" }}</strong>
    </button>
    <button
      type="button"
      class="primary launch-run-button"
      :aria-label="launchRunning ? '停止' : '运行'"
      :title="launchRunning ? '停止' : '运行'"
      :disabled="!launchRunning && (actionRunning || !hasLaunchCommand)"
      @click="launchRunning ? emit('stop') : emit('start')"
    >
      <Square v-if="launchRunning" :size="15" aria-hidden="true" />
      <Play v-else :size="15" aria-hidden="true" />
    </button>

    <p v-if="launchStatus?.error" class="error-line">{{ launchStatus.error }}</p>
  </section>
</template>
