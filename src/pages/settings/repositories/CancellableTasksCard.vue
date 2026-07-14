<script setup lang="ts">
import { computed, ref } from "vue";
import { UiButton, UiCard } from "@lilia/ui";
import { useComponentEpoch } from "../../../composables/useComponentEpoch";
import { useWorkspace } from "../../../composables/useWorkspace";
import type { WorkspaceTask } from "../../../services/workspace";

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const cancellingTaskIds = ref<string[]>([]);
const taskCancelErrors = ref<Record<string, string | undefined>>({});

const cancellableTasks = computed(() =>
  workspace.state.tasks.filter(
    (task) => task.status === "pending" && task.cancellable,
  ),
);

function isCancellingTask(taskId: string) {
  return cancellingTaskIds.value.includes(taskId);
}
function taskMessage(task: WorkspaceTask) {
  return task.message ?? "等待中";
}

async function cancelTask(taskId: string) {
  if (isCancellingTask(taskId)) return;
  cancellingTaskIds.value.push(taskId);
  delete taskCancelErrors.value[taskId];
  try {
    await workspace.cancelWorkspaceTask(taskId);
    if (!componentEpoch.assertAlive()) return;
  } catch (err) {
    if (!componentEpoch.assertAlive()) return;
    taskCancelErrors.value[taskId] = String(err);
  } finally {
    if (!componentEpoch.assertAlive()) return;
    const index = cancellingTaskIds.value.indexOf(taskId);
    if (index >= 0) cancellingTaskIds.value.splice(index, 1);
  }
}

</script>

<template>
  <UiCard
    v-if="cancellableTasks.length"
    class="cancellable-tasks-card"
    title="后台任务"
    aria-label="后台任务"
    agent-id="settings.repositories.tasks"
  >
    <ul class="workspace-task-list">
      <li v-for="task in cancellableTasks" :key="task.id" class="workspace-task-list__item">
        <span class="workspace-task-list__kind">{{ task.title }}</span>
        <div class="workspace-task-list__detail">
          <em :title="taskMessage(task)">{{ taskMessage(task) }}</em>
          <p v-if="taskCancelErrors[task.id]" class="workspace-task-list__error" role="alert">
            {{ taskCancelErrors[task.id] }}
          </p>
        </div>
        <UiButton
          size="sm"
          :agent-id="`settings.repositories.task.cancel.${task.id}`"
          :busy="isCancellingTask(task.id)"
          @click="cancelTask(task.id)"
        >
          {{ isCancellingTask(task.id) ? "取消中" : "取消" }}
        </UiButton>
      </li>
    </ul>
  </UiCard>
</template>

<style scoped>
.workspace-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.workspace-task-list__item {
  display: grid;
  grid-template-columns: minmax(0, 120px) minmax(0, 1fr) auto;
  gap: 8px;
  padding: 6px 0;
  color: var(--text-muted);
  font-size: 12px;
  align-items: center;
}

.workspace-task-list__item + .workspace-task-list__item {
  border-top: 1px solid var(--border-soft);
}

.workspace-task-list__kind {
  min-width: 0;
  color: var(--text);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.workspace-task-list__detail {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.workspace-task-list em {
  min-width: 0;
  flex: 1 1 auto;
  font-style: normal;
  overflow-wrap: anywhere;
}

.workspace-task-list__error {
  margin: 0;
  color: var(--err);
  overflow-wrap: anywhere;
}

@media (max-width: 700px) {
  .workspace-task-list__item {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .workspace-task-list__kind {
    grid-column: 1 / -1;
  }
}
</style>
