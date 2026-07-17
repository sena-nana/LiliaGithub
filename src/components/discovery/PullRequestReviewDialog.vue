<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DiscoveryConfirmDialog from "./DiscoveryConfirmDialog.vue";

export type DiscoveryReviewEvent = "approve" | "request_changes" | "comment";

const props = withDefaults(defineProps<{
  open: boolean;
  pullTitle?: string;
  busy?: boolean;
}>(), { pullTitle: "", busy: false });

const emit = defineEmits<{
  cancel: [];
  submit: [request: { event: DiscoveryReviewEvent; body?: string }];
}>();

const event = ref<DiscoveryReviewEvent>("approve");
const body = ref("");
const bodyRequired = computed(() => event.value !== "approve");
const valid = computed(() => !bodyRequired.value || Boolean(body.value.trim()));

watch(() => props.open, (open) => {
  if (!open) return;
  event.value = "approve";
  body.value = "";
});

function submit() {
  if (!valid.value) return;
  emit("submit", { event: event.value, body: body.value.trim() || undefined });
}
</script>

<template>
  <DiscoveryConfirmDialog
    :open="open"
    title="提交 Pull Request 审查"
    :description="pullTitle"
    confirm-label="提交审查"
    agent-id="discovery.pr.review-dialog"
    :busy="busy"
    @cancel="$emit('cancel')"
    @confirm="submit"
  >
    <div class="review-form">
      <label>
        <span>审查结果</span>
        <select v-model="event" data-agent-id="discovery.pr.review-dialog.event" :disabled="busy">
          <option value="approve">批准</option>
          <option value="request_changes">请求修改</option>
          <option value="comment">仅评论</option>
        </select>
      </label>
      <label>
        <span>{{ bodyRequired ? "说明（必填）" : "说明（可选）" }}</span>
        <textarea v-model="body" rows="4" data-agent-id="discovery.pr.review-dialog.body" :disabled="busy" />
      </label>
      <p v-if="!valid" role="alert">请求修改或评论时需要填写说明。</p>
    </div>
  </DiscoveryConfirmDialog>
</template>

<style scoped>
.review-form { display: grid; gap: 12px; }
.review-form label { display: grid; gap: 5px; color: var(--text-muted); font-size: 12px; }
.review-form select, .review-form textarea { width: 100%; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: var(--bg); font: inherit; }
.review-form select { min-height: 32px; padding: 0 8px; }
.review-form textarea { resize: vertical; padding: 8px; line-height: 1.45; }
.review-form p { margin: 0; color: var(--err); font-size: 11px; }
</style>
