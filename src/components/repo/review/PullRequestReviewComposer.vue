<script setup lang="ts">
import { computed, ref } from "vue";
import type { PullRequestCodeReviewEvent, SubmitPullRequestCodeReviewRequest } from "../../../services/codeReview";
import { codeReviewErrorMessage } from "./reviewError";

const props = defineProps<{
  busy: boolean;
  submitReview: (request: SubmitPullRequestCodeReviewRequest) => Promise<void>;
}>();

const event = ref<PullRequestCodeReviewEvent>("comment");
const body = ref("");
const pending = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const bodyRequired = computed(() => event.value !== "approve");
const valid = computed(() => !bodyRequired.value || Boolean(body.value.trim()));

async function submit() {
  if (!valid.value || pending.value || props.busy) return;
  pending.value = true;
  error.value = null;
  notice.value = null;
  try {
    await props.submitReview({ event: event.value, body: body.value.trim() || null });
    notice.value = event.value === "approve" ? "已提交批准。" : event.value === "request_changes" ? "已请求修改。" : "已提交 review 评论。";
    body.value = "";
  } catch (reason) {
    error.value = codeReviewErrorMessage(reason, { draftPreserved: true });
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form class="review-composer" data-agent-id="repo.pulls.review.submit" @submit.prevent="submit">
    <header><h4>提交 Review</h4><span>选择结果并向作者说明下一步。</span></header>
    <label>
      <span>Review 结果</span>
      <select v-model="event" :disabled="busy || pending" data-agent-id="repo.pulls.review.submit.event">
        <option value="comment">Comment</option>
        <option value="approve">Approve</option>
        <option value="request_changes">Request changes</option>
      </select>
    </label>
    <label class="review-composer__body">
      <span>{{ bodyRequired ? "说明（必填）" : "说明（可选）" }}</span>
      <textarea v-model="body" rows="4" :disabled="busy || pending" data-agent-id="repo.pulls.review.submit.body" />
    </label>
    <p v-if="!valid" class="is-error">Comment 和 Request changes 需要填写说明。</p>
    <p v-if="error" class="is-error" role="alert" data-agent-id="repo.pulls.review.submit.error">{{ error }}</p>
    <p v-if="notice" class="is-notice" role="status" data-agent-id="repo.pulls.review.submit.notice">{{ notice }}</p>
    <button type="submit" class="primary" :disabled="busy || pending || !valid" data-agent-id="repo.pulls.review.submit.confirm">{{ pending ? "正在提交..." : "提交 Review" }}</button>
  </form>
</template>

<style scoped>
.review-composer { display: grid; grid-template-columns: minmax(150px, .35fr) minmax(0, 1fr) auto; align-items: end; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.review-composer header { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 8px; }
.review-composer h4 { margin: 0; font-size: 13px; }
.review-composer header span, .review-composer label > span { color: var(--text-muted); font-size: 11px; }
.review-composer label { display: grid; gap: 5px; }
.review-composer select { min-height: 32px; }
.review-composer textarea { resize: vertical; }
.review-composer p { grid-column: 1 / -1; margin: 0; font-size: 11px; }
.review-composer .is-error { color: var(--err); }
.review-composer .is-notice { color: var(--ok); }
@media (max-width: 760px) { .review-composer { grid-template-columns: 1fr; } .review-composer header, .review-composer p { grid-column: 1; } }
</style>
