<script setup lang="ts">
import {
  ArrowLeft,
  CircleDot,
  CircleOff,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type {
  GitHubDiscussionTimelineItem,
  GitHubIssue,
} from "../../services/workspace/types";
import RepoIssueConversation from "./RepoIssueConversation.vue";
import { updateGitHubIssue } from "../../services/workspace/client";
import "./styles/githubDetailSurface.css";

const props = defineProps<{
  issue: GitHubIssue;
  timeline: readonly GitHubDiscussionTimelineItem[];
  discussionLoading: boolean;
  discussionError: string | null;
  repoFullName: string;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

const emit = defineEmits<{
  back: [];
}>();

const statusText = computed(() => props.issue.state === "open" ? "Open" : "Closed");
const linkBaseUrl = computed(() => `https://github.com/${props.repoFullName}`);
const milestoneDraft = ref("");
const milestonePending = ref(false);
const milestoneError = ref<string | null>(null);
const milestoneTitle = ref<string | null>(null);

watch(() => props.issue, (issue) => {
  milestoneDraft.value = issue.milestone ? String(issue.milestone.number) : "";
  milestoneTitle.value = issue.milestone?.title ?? null;
}, { immediate: true });

async function saveMilestone() {
  if (milestonePending.value) return;
  const milestone = milestoneDraft.value.trim() ? Number(milestoneDraft.value) : null;
  if (milestone !== null && (!Number.isInteger(milestone) || milestone <= 0)) {
    milestoneError.value = "请输入有效的 milestone 编号";
    return;
  }
  milestonePending.value = true; milestoneError.value = null;
  try {
    const updated = await updateGitHubIssue(props.repoFullName, props.issue.number, { milestone });
    milestoneDraft.value = updated.milestone ? String(updated.milestone.number) : "";
    milestoneTitle.value = updated.milestone?.title ?? null;
  } catch (error) {
    milestoneError.value = String(error).replace(/^Error:\s*/, "");
  } finally { milestonePending.value = false; }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
</script>

<template>
  <article class="github-detail issue-detail" aria-label="Issue 详情">
    <button type="button" class="ghost github-detail__back" data-agent-id="repo.issues.detail.back" @click="emit('back')">
      <ArrowLeft :size="14" aria-hidden="true" />
      Issues
    </button>

    <header class="github-detail__title-block">
      <div class="github-detail__status" :class="issue.state === 'open' ? 'is-accent' : 'is-closed'">
        <CircleDot v-if="issue.state === 'open'" :size="16" aria-hidden="true" />
        <CircleOff v-else :size="16" aria-hidden="true" />
        <span>{{ statusText }}</span>
      </div>
      <h3>#{{ issue.number }} {{ issue.title }}</h3>
      <p>
        {{ issue.author || "未知作者" }} opened
        <time :datetime="issue.createdAt">{{ formatDateTime(issue.createdAt) }}</time>
        · updated
        <time :datetime="issue.updatedAt">{{ formatDateTime(issue.updatedAt) }}</time>
      </p>
    </header>

    <form class="issue-detail__milestone" @submit.prevent="saveMilestone">
      <label for="issue-milestone">Milestone</label>
      <input id="issue-milestone" v-model="milestoneDraft" type="number" min="1" inputmode="numeric" data-agent-id="repo.issues.detail.milestone-input" placeholder="未设置" />
      <button type="submit" data-agent-id="repo.issues.detail.milestone-save" :disabled="milestonePending">{{ milestonePending ? "保存中" : "保存" }}</button>
      <span v-if="milestoneTitle" class="muted">{{ milestoneTitle }}</span>
      <p v-if="milestoneError" class="repo-error" data-agent-id="repo.issues.detail.milestone-error">{{ milestoneError }}</p>
    </form>

    <RepoIssueConversation
      :repo-full-name="repoFullName"
      :issue-number="issue.number"
      :items="timeline"
      :loading="discussionLoading"
      :error="discussionError"
      :link-base-url="linkBaseUrl"
      :timeline-item-opener="props.timelineItemOpener"
      empty-text="当前 Issue 没有讨论内容。"
    />
  </article>
</template>

<style scoped>
.issue-detail__milestone { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.issue-detail__milestone label { font-size: 12px; font-weight: 650; }
.issue-detail__milestone input { width: 120px; }
.issue-detail__milestone p { flex-basis: 100%; margin: 0; }
</style>
