<script setup lang="ts">
import {
  ArrowLeft,
  CircleOff,
  GitMerge,
  GitPullRequest,
} from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import { openUrl, updateGitHubPullRequest } from "../../services/workspace/client";
import type {
  GitHubDiscussionTimelineItem,
  GitHubPullRequest,
  GitHubPullRequestCheck,
} from "../../services/workspace/types";
import RepoIssueConversation from "./RepoIssueConversation.vue";
import PullRequestCodeReviewWorkspace from "./review/PullRequestCodeReviewWorkspace.vue";
import "./styles/githubDetailSurface.css";

const props = defineProps<{
  pull: GitHubPullRequest;
  checks: readonly GitHubPullRequestCheck[];
  checksLoading: boolean;
  discussionTimeline: readonly GitHubDiscussionTimelineItem[];
  discussionLoading: boolean;
  discussionError: string | null;
  updating: boolean;
  mergeMethod: "merge" | "squash" | "rebase";
  repoFullName: string;
  worktreePath?: string | null;
  currentBranch?: string | null;
  remoteUrl?: string | null;
  sourceRoute: string;
  timelineItemOpener?: (item: GitHubDiscussionTimelineItem) => void;
}>();

const emit = defineEmits<{
  back: [];
  merge: [pull: GitHubPullRequest];
  "update:mergeMethod": [value: "merge" | "squash" | "rebase"];
}>();

const statusText = computed(() => {
  if (props.pull.merged) return "Merged";
  if (props.pull.draft) return "Draft";
  return props.pull.state === "open" ? "Open" : "Closed";
});

const linkBaseUrl = computed(() => `https://github.com/${props.repoFullName}`);
const metadata = reactive({ title: "", body: "", state: "open", labels: "", assignees: "", milestone: "" });
const metadataPending = ref(false);
const metadataError = ref<string | null>(null);
const metadataNotice = ref<string | null>(null);

watch(() => props.pull, (pull) => {
  metadata.title = pull.title; metadata.body = pull.body ?? ""; metadata.state = pull.state;
  metadata.labels = pull.labels.join(", "); metadata.assignees = pull.assignees.join(", ");
  metadata.milestone = pull.milestone ? String(pull.milestone.number) : "";
}, { immediate: true });

function splitList(value: string) { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }
async function saveMetadata() {
  if (metadataPending.value || !metadata.title.trim()) return;
  const milestone = metadata.milestone.trim() ? Number(metadata.milestone) : null;
  if (milestone !== null && (!Number.isInteger(milestone) || milestone <= 0)) { metadataError.value = "请输入有效的 milestone 编号"; return; }
  metadataPending.value = true; metadataError.value = null; metadataNotice.value = null;
  try {
    const updated = await updateGitHubPullRequest(props.repoFullName, props.pull.number, {
      title: metadata.title.trim(), body: metadata.body, state: metadata.state,
      labels: splitList(metadata.labels), assignees: splitList(metadata.assignees), milestone,
    });
    metadata.title = updated.title; metadata.body = updated.body ?? ""; metadata.state = updated.state;
    metadata.labels = updated.labels.join(", "); metadata.assignees = updated.assignees.join(", ");
    metadata.milestone = updated.milestone ? String(updated.milestone.number) : "";
    metadataNotice.value = "Pull Request 元数据已保存。";
  } catch (error) { metadataError.value = String(error).replace(/^Error:\s*/, ""); }
  finally { metadataPending.value = false; }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function checkText(check: GitHubPullRequestCheck) {
  return check.conclusion ?? check.status;
}

function checkUrl(check: GitHubPullRequestCheck) {
  return check.htmlUrl ?? check.detailsUrl;
}

function openCheck(check: GitHubPullRequestCheck) {
  const url = checkUrl(check);
  if (url) void openUrl(url);
}
</script>

<template>
  <article class="github-detail pull-detail" aria-label="Pull Request 详情">
    <button type="button" class="ghost github-detail__back" @click="emit('back')">
      <ArrowLeft :size="14" aria-hidden="true" />
      Pull Requests
    </button>

    <header class="github-detail__title-block">
      <div
        class="github-detail__status"
        :class="{
          'is-accent': pull.merged,
          'is-muted': pull.draft && !pull.merged,
          'is-closed': !pull.merged && pull.state !== 'open',
        }"
      >
        <GitMerge v-if="pull.merged" :size="16" aria-hidden="true" />
        <GitPullRequest v-else-if="pull.state === 'open'" :size="16" aria-hidden="true" />
        <CircleOff v-else :size="16" aria-hidden="true" />
        <span>{{ statusText }}</span>
      </div>
      <h3>#{{ pull.number }} {{ pull.title }}</h3>
      <p>
        {{ pull.author || "未知作者" }} opened
        <time :datetime="pull.createdAt">{{ formatDateTime(pull.createdAt) }}</time>
        · updated
        <time :datetime="pull.updatedAt">{{ formatDateTime(pull.updatedAt) }}</time>
      </p>
    </header>

    <details class="github-detail__form-block pull-detail__metadata" data-agent-id="repo.pulls.detail.metadata">
      <summary>编辑 Pull Request 信息</summary>
      <form class="pull-detail__metadata-form" @submit.prevent="saveMetadata">
        <label>标题<input v-model="metadata.title" data-agent-id="repo.pulls.detail.metadata.title" required /></label>
        <label class="is-wide">正文<textarea v-model="metadata.body" rows="4" data-agent-id="repo.pulls.detail.metadata.body" /></label>
        <label>状态<select v-model="metadata.state" data-agent-id="repo.pulls.detail.metadata.state"><option value="open">Open</option><option value="closed">Closed</option></select></label>
        <label>Labels<input v-model="metadata.labels" data-agent-id="repo.pulls.detail.metadata.labels" placeholder="bug, ui" /></label>
        <label>Assignees<input v-model="metadata.assignees" data-agent-id="repo.pulls.detail.metadata.assignees" placeholder="octocat" /></label>
        <label>Milestone<input v-model="metadata.milestone" type="number" min="1" data-agent-id="repo.pulls.detail.metadata.milestone" placeholder="未设置" /></label>
        <p v-if="metadataError" class="repo-error" data-agent-id="repo.pulls.detail.metadata.error">{{ metadataError }}</p>
        <p v-if="metadataNotice" class="muted" role="status" data-agent-id="repo.pulls.detail.metadata.result">{{ metadataNotice }}</p>
        <button type="submit" data-agent-id="repo.pulls.detail.metadata.save" :disabled="metadataPending || !metadata.title.trim()">{{ metadataPending ? "保存中" : "保存信息" }}</button>
      </form>
    </details>

    <section class="github-detail__section" aria-label="Checks">
      <div class="github-detail__section-head">
        <h4>Checks</h4>
        <span>{{ checksLoading ? "正在读取..." : checks.length ? `${checks.length} 个 checks` : "没有 checks" }}</span>
      </div>
      <ul v-if="checks.length" class="github-detail__rows">
        <li v-for="check in checks" :key="check.id" class="github-detail__row">
          <span>{{ check.name }}</span>
          <button v-if="checkUrl(check)" type="button" @click="openCheck(check)">
            {{ checkText(check) }}
          </button>
          <em v-else>{{ checkText(check) }}</em>
        </li>
      </ul>
      <p v-else class="github-detail__muted">当前 Pull Request 没有 check 记录。</p>
    </section>

    <PullRequestCodeReviewWorkspace
      :repo-full-name="repoFullName"
      :pull="pull"
      :checks="checks"
      :updating="updating"
      :merge-method="mergeMethod"
      :worktree-path="worktreePath"
      :current-branch="currentBranch"
      :remote-url="remoteUrl"
      :source-route="sourceRoute"
      @merge="emit('merge', $event)"
      @update:merge-method="emit('update:mergeMethod', $event)"
    />

    <section class="github-detail__section github-detail__divider" aria-label="Pull Request 讨论">
      <div class="github-detail__section-head">
        <h4>讨论</h4>
      </div>
      <RepoIssueConversation
        :repo-full-name="repoFullName"
        :issue-number="pull.number"
        :items="discussionTimeline"
        :loading="discussionLoading"
        :error="discussionError"
        :link-base-url="linkBaseUrl"
        :timeline-item-opener="props.timelineItemOpener"
        empty-text="当前 Pull Request 没有讨论内容。"
      />
    </section>
  </article>
</template>

<style scoped>
.pull-detail__metadata-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.pull-detail__metadata-form label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
.pull-detail__metadata-form .is-wide, .pull-detail__metadata-form p { grid-column: 1 / -1; }
.pull-detail__metadata-form textarea { resize: vertical; }
.pull-detail__metadata-form button { justify-self: end; grid-column: 1 / -1; }
@media (max-width: 760px) { .pull-detail__metadata-form { grid-template-columns: 1fr; } }
</style>
