<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue";
import { Dropdown } from "@lilia/ui";
import { computed } from "vue";
import type { GitHubRepositoryDiscussionCategory } from "../../../services/workspace/discussions/types";

const props = defineProps<{
  categories: readonly GitHubRepositoryDiscussionCategory[];
  categoryId: string;
  title: string;
  body: string;
  creating: boolean;
  canSubmit: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  "update:categoryId": [value: string];
  "update:title": [value: string];
  "update:body": [value: string];
  cancel: [];
  submit: [];
}>();

const categoryOptions = computed(() => props.categories.map((category) => ({
  value: category.id,
  label: `${category.emoji} ${category.name}`,
  hint: category.description ?? undefined,
})));
</script>

<template>
  <form class="discussion-create" aria-label="新建 Discussion" @submit.prevent="emit('submit')">
    <header>
      <div>
        <h3>新建 Discussion</h3>
        <p>选择分类并清楚描述要讨论的内容。</p>
      </div>
      <button
        type="button"
        class="ghost"
        data-agent-id="repo.discussions.form.cancel"
        :disabled="creating"
        @click="emit('cancel')"
      >取消</button>
    </header>
    <label>
      <span>分类</span>
      <Dropdown
        :model-value="categoryId"
        :options="categoryOptions"
        menu-label="Discussion 分类"
        agent-id="repo.discussions.form.category"
        @update:model-value="emit('update:categoryId', $event)"
      />
    </label>
    <label>
      <span>标题</span>
      <input
        :value="title"
        data-agent-id="repo.discussions.form.title"
        type="text"
        maxlength="200"
        :disabled="creating"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <label>
      <span>正文</span>
      <textarea
        :value="body"
        data-agent-id="repo.discussions.form.body"
        rows="10"
        :disabled="creating"
        @input="emit('update:body', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
    </label>
    <p v-if="error" class="repo-error">{{ error }}</p>
    <footer>
      <button
        type="submit"
        class="primary"
        data-agent-id="repo.discussions.form.submit"
        :disabled="!canSubmit"
      >
        <LoaderCircle v-if="creating" :size="14" class="sb-spin" />
        {{ creating ? "正在创建" : "创建 Discussion" }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.discussion-create {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.discussion-create header,
.discussion-create footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.discussion-create h3,
.discussion-create p {
  margin: 0;
}

.discussion-create header p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-create label {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.discussion-create input,
.discussion-create textarea {
  width: 100%;
  min-width: 0;
}

.discussion-create textarea {
  resize: vertical;
}

.discussion-create footer {
  justify-content: flex-end;
}

.discussion-create footer button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 760px) {
  .discussion-create header {
    flex-direction: column;
  }
}
</style>
