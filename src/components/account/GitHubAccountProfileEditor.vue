<script setup lang="ts">
import { Dropdown, SettingsRow, UiButton, UiCard, UiInput, UiTextarea } from "@lilia/ui";
import { computed, reactive, ref, watch } from "vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import type { GitHubAccountProfile } from "../../services/workspace";

type ProfileDraft = {
  name: string;
  email: string;
  bio: string;
  company: string;
  location: string;
  blog: string;
  twitterUsername: string;
  hireable: "yes" | "no";
};

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const profileLoader = createLatestAsyncLoader({ componentEpoch });
const profile = ref<GitHubAccountProfile | null>(null);
const draft = reactive<ProfileDraft>(blankDraft());
const baseline = ref("");
const loading = ref(false);
const saving = ref(false);
const authorizing = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const binding = computed(() => workspace.githubBinding.value);
const canEdit = computed(() => binding.value?.scopes.includes("user") === true);
const dirty = computed(() => JSON.stringify(draft) !== baseline.value);
const hireableOptions = [
  { value: "yes", label: "愿意接受机会", agentId: "profile.hireable.yes" },
  { value: "no", label: "暂不考虑", agentId: "profile.hireable.no" },
] as const;

function blankDraft(): ProfileDraft {
  return { name: "", email: "", bio: "", company: "", location: "", blog: "", twitterUsername: "", hireable: "no" };
}

function applyProfile(next: GitHubAccountProfile) {
  profile.value = next;
  Object.assign(draft, {
    name: next.name ?? "",
    email: next.email ?? "",
    bio: next.bio ?? "",
    company: next.company ?? "",
    location: next.location ?? "",
    blog: next.blog ?? "",
    twitterUsername: next.twitterUsername ?? "",
    hireable: next.hireable ? "yes" : "no",
  } satisfies ProfileDraft);
  baseline.value = JSON.stringify(draft);
}

function profileError(err: unknown) {
  const message = String(err).replace(/^Error:\s*/, "");
  if (/401|绑定.*失效|unauthorized/i.test(message)) return "GitHub 绑定已失效，请重新绑定后再试。";
  if (/403|scope|permission|权限/i.test(message)) return "当前授权不能修改个人资料，请先授权编辑资料。";
  if (/422|validation|invalid/i.test(message)) return "资料未能保存，请检查邮箱、网站和用户名格式。";
  return message;
}

function accountContextKey() {
  const current = binding.value;
  return current
    ? `${current.login.toLocaleLowerCase()}:${current.boundAt}:${[...current.scopes].sort().join(",")}`
    : "";
}

async function loadProfile() {
  const contextKey = accountContextKey();
  if (!contextKey) return;
  await profileLoader.run(contextKey, async (runId) => {
    loading.value = true;
    error.value = null;
    notice.value = null;
    try {
      const next = await workspace.getAccountProfile();
      if (profileLoader.isCurrent(runId) && accountContextKey() === contextKey) applyProfile(next);
    } catch (err) {
      if (profileLoader.isCurrent(runId) && accountContextKey() === contextKey) error.value = profileError(err);
    } finally {
      if (profileLoader.isCurrent(runId)) loading.value = false;
    }
  });
}

async function authorizeEditing() {
  if (authorizing.value) return;
  authorizing.value = true;
  error.value = null;
  try {
    await workspace.startAuthFlow("profileWrite");
    if (componentEpoch.assertAlive() && workspace.state.error) error.value = workspace.state.error;
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = profileError(err);
  } finally {
    if (componentEpoch.assertAlive()) authorizing.value = false;
  }
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

async function saveProfile() {
  if (!canEdit.value || saving.value || !dirty.value) return;
  const contextKey = accountContextKey();
  if (!contextKey) return;
  saving.value = true;
  error.value = null;
  notice.value = null;
  try {
    const next = await workspace.updateAccountProfile({
      name: optionalValue(draft.name),
      email: optionalValue(draft.email),
      bio: optionalValue(draft.bio),
      company: optionalValue(draft.company),
      location: optionalValue(draft.location),
      blog: optionalValue(draft.blog),
      twitterUsername: optionalValue(draft.twitterUsername),
      hireable: draft.hireable === "yes",
    });
    if (!componentEpoch.assertAlive() || accountContextKey() !== contextKey) return;
    applyProfile(next);
    notice.value = "个人资料已保存。";
  } catch (err) {
    if (componentEpoch.assertAlive() && accountContextKey() === contextKey) error.value = profileError(err);
  } finally {
    if (componentEpoch.assertAlive() && accountContextKey() === contextKey) saving.value = false;
  }
}

watch(
  accountContextKey,
  () => {
    profileLoader.invalidate();
    loading.value = false;
    saving.value = false;
    profile.value = null;
    Object.assign(draft, blankDraft());
    baseline.value = JSON.stringify(draft);
    void loadProfile();
  },
  { immediate: true },
);
</script>

<template>
  <UiCard title="公开资料" aria-label="GitHub 公开资料" agent-id="profile.editor" :loading="loading">
    <SettingsRow label="账号" hint="GitHub 登录名不可在此修改。" divided loose>
      <div class="profile-editor__identity">
        <img v-if="profile?.avatarUrl || binding?.avatarUrl" :src="profile?.avatarUrl ?? binding?.avatarUrl ?? ''" alt="" class="profile-editor__avatar">
        <span>{{ profile?.login ?? binding?.login }}</span>
      </div>
    </SettingsRow>
    <SettingsRow v-if="!canEdit" label="编辑权限" hint="授权后可以在此更新 GitHub 公开资料。" divided>
      <UiButton size="sm" agent-id="profile.authorize" :busy="authorizing || workspace.state.authLoading" :disabled="workspace.state.authLoading" @click="authorizeEditing">授权编辑资料</UiButton>
    </SettingsRow>
    <div class="profile-editor__grid">
      <SettingsRow label="姓名" stacked><UiInput v-model="draft.name" agent-id="profile.name" :disabled="!canEdit" /></SettingsRow>
      <SettingsRow label="公开邮箱" stacked><UiInput v-model="draft.email" type="email" agent-id="profile.email" :disabled="!canEdit" /></SettingsRow>
      <SettingsRow label="公司" stacked><UiInput v-model="draft.company" agent-id="profile.company" :disabled="!canEdit" /></SettingsRow>
      <SettingsRow label="所在地" stacked><UiInput v-model="draft.location" agent-id="profile.location" :disabled="!canEdit" /></SettingsRow>
      <SettingsRow label="网站" stacked><UiInput v-model="draft.blog" type="url" agent-id="profile.blog" :disabled="!canEdit" /></SettingsRow>
      <SettingsRow label="X 用户名" stacked><UiInput v-model="draft.twitterUsername" agent-id="profile.twitter" :disabled="!canEdit" /></SettingsRow>
      <SettingsRow label="求职状态" stacked>
        <Dropdown v-model="draft.hireable" :options="hireableOptions" block size="large" placement="bottom" agent-id="profile.hireable" :disabled="!canEdit" />
      </SettingsRow>
      <SettingsRow label="简介" stacked class="profile-editor__bio"><UiTextarea v-model="draft.bio" agent-id="profile.bio" :disabled="!canEdit" /></SettingsRow>
    </div>
    <div class="profile-editor__footer">
      <p v-if="error" class="profile-editor__error" role="alert">{{ error }}</p>
      <p v-else-if="notice" class="profile-editor__notice" role="status">{{ notice }}</p>
      <UiButton variant="primary" size="sm" agent-id="profile.save" :disabled="!canEdit || !dirty || loading" :busy="saving" @click="saveProfile">保存资料</UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.profile-editor__identity { display: inline-flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; font-weight: 600; }
.profile-editor__avatar { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border); }
.profile-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.profile-editor__bio { grid-column: 1 / -1; }
.profile-editor__bio :deep(textarea) { min-height: 76px; resize: vertical; }
.profile-editor__footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 10px; }
.profile-editor__error, .profile-editor__notice { flex: 1; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.profile-editor__error { color: var(--err); }
.profile-editor__notice { color: var(--ok); }
@media (max-width: 760px) { .profile-editor__grid { grid-template-columns: minmax(0, 1fr); } .profile-editor__bio { grid-column: auto; } }
</style>
