<script setup lang="ts">
import {
  AtSign,
  BriefcaseBusiness,
  Building2,
  ExternalLink,
  Globe2,
  Mail,
  MapPin,
} from "@lucide/vue";
import { UiButton, UiInput, UiSwitch, UiTextarea } from "@lilia/ui";
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
  hireable: boolean;
};

const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const profileLoader = createLatestAsyncLoader({ componentEpoch });
const profile = ref<GitHubAccountProfile | null>(null);
const draft = reactive<ProfileDraft>(blankDraft());
const baseline = ref("");
const loading = ref(false);
const saving = ref(false);
const editing = ref(false);
const authorizing = ref(false);
const openingGitHub = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const binding = computed(() => workspace.githubBinding.value);
const canEdit = computed(() => binding.value?.scopes.includes("user") === true);
const dirty = computed(() => JSON.stringify(draft) !== baseline.value);
const authPending = computed(() =>
  authorizing.value
  || workspace.state.authLoading
  || workspace.state.authFlowStatus === "pending",
);
const authorizationError = computed(() => {
  if (error.value) return error.value;
  if (workspace.state.authFlowStatus === "error" || workspace.state.authFlowStatus === "expired") {
    return workspace.state.error ? profileError(workspace.state.error) : null;
  }
  return null;
});

function blankDraft(): ProfileDraft {
  return {
    name: "",
    email: "",
    bio: "",
    company: "",
    location: "",
    blog: "",
    twitterUsername: "",
    hireable: false,
  };
}

function draftFromProfile(next: GitHubAccountProfile): ProfileDraft {
  return {
    name: next.name ?? "",
    email: next.email ?? "",
    bio: next.bio ?? "",
    company: next.company ?? "",
    location: next.location ?? "",
    blog: next.blog ?? "",
    twitterUsername: next.twitterUsername ?? "",
    hireable: next.hireable === true,
  };
}

function applyProfile(next: GitHubAccountProfile) {
  profile.value = next;
  Object.assign(draft, draftFromProfile(next));
  baseline.value = JSON.stringify(draft);
}

function profileError(err: unknown) {
  const message = String(err).replace(/^Error:\s*/, "");
  if (/401|绑定.*失效|unauthorized/i.test(message)) return "GitHub 绑定已失效，请重新绑定后再试。";
  if (/403|scope|permission|权限/i.test(message)) return "当前授权不能修改个人资料，请先授权编辑资料。";
  if (/422|validation|invalid/i.test(message)) return "资料未能保存，请检查邮箱、网站和用户名格式。";
  return "暂时无法读取或更新个人资料，请稍后重试。";
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

function beginEditing() {
  if (!profile.value || !canEdit.value || loading.value || saving.value) return;
  Object.assign(draft, draftFromProfile(profile.value));
  baseline.value = JSON.stringify(draft);
  error.value = null;
  notice.value = null;
  editing.value = true;
}

function cancelEditing() {
  if (!profile.value || saving.value) return;
  Object.assign(draft, draftFromProfile(profile.value));
  baseline.value = JSON.stringify(draft);
  error.value = null;
  notice.value = null;
  editing.value = false;
}

async function authorizeEditing() {
  if (authPending.value) return;
  authorizing.value = true;
  error.value = null;
  notice.value = null;
  try {
    await workspace.startAuthFlow("profileWrite");
    if (componentEpoch.assertAlive() && workspace.state.error) error.value = profileError(workspace.state.error);
  } catch (err) {
    if (componentEpoch.assertAlive()) error.value = profileError(err);
  } finally {
    if (componentEpoch.assertAlive()) authorizing.value = false;
  }
}

async function openGitHubProfile() {
  if (!profile.value || openingGitHub.value) return;
  const contextKey = accountContextKey();
  openingGitHub.value = true;
  error.value = null;
  try {
    await workspace.openUrl(`https://github.com/${encodeURIComponent(profile.value.login)}`);
  } catch {
    if (componentEpoch.assertAlive() && accountContextKey() === contextKey) {
      error.value = "无法打开 GitHub 个人主页，请重试。";
    }
  } finally {
    if (componentEpoch.assertAlive() && accountContextKey() === contextKey) openingGitHub.value = false;
  }
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

async function saveProfile() {
  if (!editing.value || !profile.value || !canEdit.value || saving.value || !dirty.value) return;
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
      hireable: draft.hireable,
    });
    if (!componentEpoch.assertAlive() || accountContextKey() !== contextKey) return;
    applyProfile(next);
    editing.value = false;
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
    editing.value = false;
    openingGitHub.value = false;
    profile.value = null;
    Object.assign(draft, blankDraft());
    baseline.value = JSON.stringify(draft);
    void loadProfile();
  },
  { immediate: true },
);
</script>

<template>
  <div class="profile-editor" data-agent-id="profile.editor">
    <template v-if="loading && !profile">
      <aside class="profile-editor__sidebar profile-editor__sidebar--skeleton" aria-label="正在加载个人资料">
        <div class="profile-editor__skeleton profile-editor__skeleton--avatar" />
        <div class="profile-editor__skeleton profile-editor__skeleton--name" />
        <div class="profile-editor__skeleton profile-editor__skeleton--login" />
        <div class="profile-editor__skeleton profile-editor__skeleton--bio" />
      </aside>
      <section class="profile-editor__content profile-editor__content--skeleton" aria-hidden="true">
        <div class="profile-editor__skeleton profile-editor__skeleton--heading" />
        <div v-for="index in 5" :key="index" class="profile-editor__skeleton profile-editor__skeleton--row" />
      </section>
    </template>

    <div v-else-if="!profile" class="profile-editor__load-error card" role="alert">
      <div>
        <h2>无法加载个人资料</h2>
        <p>{{ error || "暂时无法读取 GitHub 公开资料，请稍后重试。" }}</p>
      </div>
      <UiButton size="sm" agent-id="profile.retry" :busy="loading" @click="loadProfile">
        重新加载
      </UiButton>
    </div>

    <template v-else>
      <aside class="profile-editor__sidebar" aria-label="GitHub 身份信息">
        <img
          v-if="profile.avatarUrl || binding?.avatarUrl"
          :src="profile.avatarUrl ?? binding?.avatarUrl ?? ''"
          :alt="`${profile.login} 的头像`"
          class="profile-editor__avatar"
        >
        <div v-else class="profile-editor__avatar profile-editor__avatar--fallback" aria-hidden="true">
          {{ profile.login.slice(0, 1).toLocaleUpperCase() }}
        </div>

        <div class="profile-editor__identity">
          <h1>{{ profile.name || profile.login }}</h1>
          <p>{{ profile.login }}</p>
        </div>
        <p v-if="profile.bio" class="profile-editor__bio">{{ profile.bio }}</p>

        <UiButton
          class="profile-editor__external"
          size="sm"
          agent-id="profile.open-github"
          :busy="openingGitHub"
          :disabled="openingGitHub"
          @click="openGitHubProfile"
        >
          <ExternalLink :size="14" aria-hidden="true" />
          在 GitHub 查看
        </UiButton>

        <ul class="profile-editor__metadata" aria-label="公开资料摘要">
          <li v-if="profile.company">
            <Building2 :size="15" aria-hidden="true" />
            <span>{{ profile.company }}</span>
          </li>
          <li v-if="profile.location">
            <MapPin :size="15" aria-hidden="true" />
            <span>{{ profile.location }}</span>
          </li>
          <li v-if="profile.email">
            <Mail :size="15" aria-hidden="true" />
            <span>{{ profile.email }}</span>
          </li>
          <li v-if="profile.blog">
            <Globe2 :size="15" aria-hidden="true" />
            <span>{{ profile.blog }}</span>
          </li>
          <li v-if="profile.twitterUsername">
            <AtSign :size="15" aria-hidden="true" />
            <span>{{ profile.twitterUsername }}</span>
          </li>
          <li>
            <BriefcaseBusiness :size="15" aria-hidden="true" />
            <span>{{ profile.hireable ? "愿意接受工作机会" : "暂不考虑工作机会" }}</span>
          </li>
        </ul>
      </aside>

      <section class="profile-editor__content" data-agent-id="profile.content" aria-label="公开资料详情">
        <header class="profile-editor__content-header">
          <div>
            <h2>{{ editing ? "编辑公开资料" : "公开资料" }}</h2>
            <p>{{ editing ? "保存后，修改将同步到 GitHub。" : "这些信息会显示在你的 GitHub 个人主页。" }}</p>
          </div>
          <UiButton
            v-if="canEdit && !editing"
            size="sm"
            agent-id="profile.edit"
            :disabled="loading || saving"
            @click="beginEditing"
          >
            编辑资料
          </UiButton>
        </header>

        <div v-if="!canEdit" class="profile-editor__authorization" data-agent-id="profile.authorization" role="status">
          <div>
            <h3>{{ authPending ? "等待 GitHub 授权" : "授权后可编辑资料" }}</h3>
            <p v-if="authPending">
              已在浏览器中打开 GitHub 授权页，请输入设备码并确认授权。
            </p>
            <p v-else>当前绑定仅支持查看公开资料，补充授权后即可在此更新。</p>
          </div>
          <div v-if="workspace.deviceFlow?.value" class="profile-editor__device-flow">
            <span>设备码</span>
            <code data-agent-id="profile.authorization.code">{{ workspace.deviceFlow.value.userCode }}</code>
            <small v-if="workspace.authRemainingText?.value">剩余 {{ workspace.authRemainingText.value }}</small>
          </div>
          <UiButton
            v-else
            variant="primary"
            size="sm"
            agent-id="profile.authorize"
            :busy="authPending"
            :disabled="authPending"
            @click="authorizeEditing"
          >
            授权编辑资料
          </UiButton>
        </div>

        <form v-if="editing" class="profile-editor__form" @submit.prevent="saveProfile">
          <div class="profile-editor__field">
            <label for="profile-name">姓名</label>
            <UiInput id="profile-name" v-model="draft.name" agent-id="profile.name" :disabled="saving" />
          </div>
          <div class="profile-editor__field">
            <label for="profile-email">公开邮箱</label>
            <UiInput id="profile-email" v-model="draft.email" type="email" agent-id="profile.email" :disabled="saving" />
          </div>
          <div class="profile-editor__field">
            <label for="profile-company">公司</label>
            <UiInput id="profile-company" v-model="draft.company" agent-id="profile.company" :disabled="saving" />
          </div>
          <div class="profile-editor__field">
            <label for="profile-location">所在地</label>
            <UiInput id="profile-location" v-model="draft.location" agent-id="profile.location" :disabled="saving" />
          </div>
          <div class="profile-editor__field">
            <label for="profile-blog">网站</label>
            <UiInput id="profile-blog" v-model="draft.blog" type="url" agent-id="profile.blog" :disabled="saving" />
          </div>
          <div class="profile-editor__field">
            <label for="profile-twitter">X 用户名</label>
            <UiInput id="profile-twitter" v-model="draft.twitterUsername" agent-id="profile.twitter" :disabled="saving" />
          </div>
          <div class="profile-editor__field profile-editor__field--switch">
            <UiSwitch
              v-model="draft.hireable"
              label="愿意接受工作机会"
              hint="保存后会同步到 GitHub 公开资料。"
              control-position="end"
              block
              agent-id="profile.hireable"
              :disabled="saving"
            />
          </div>
          <div class="profile-editor__field profile-editor__field--bio">
            <label for="profile-bio">简介</label>
            <UiTextarea id="profile-bio" v-model="draft.bio" agent-id="profile.bio" :disabled="saving" />
          </div>
          <div class="profile-editor__form-footer">
            <UiButton type="button" size="sm" agent-id="profile.cancel" :disabled="saving" @click="cancelEditing">
              取消
            </UiButton>
            <UiButton
              type="submit"
              variant="primary"
              size="sm"
              agent-id="profile.save"
              :disabled="!dirty || saving"
              :busy="saving"
            >
              保存资料
            </UiButton>
          </div>
        </form>

        <dl v-else class="profile-editor__details">
          <div>
            <dt>姓名</dt>
            <dd>{{ profile.name || "未填写" }}</dd>
          </div>
          <div>
            <dt>公开邮箱</dt>
            <dd>{{ profile.email || "未填写" }}</dd>
          </div>
          <div>
            <dt>公司</dt>
            <dd>{{ profile.company || "未填写" }}</dd>
          </div>
          <div>
            <dt>所在地</dt>
            <dd>{{ profile.location || "未填写" }}</dd>
          </div>
          <div>
            <dt>网站</dt>
            <dd>{{ profile.blog || "未填写" }}</dd>
          </div>
          <div>
            <dt>X 用户名</dt>
            <dd>{{ profile.twitterUsername || "未填写" }}</dd>
          </div>
          <div>
            <dt>求职状态</dt>
            <dd>{{ profile.hireable ? "愿意接受机会" : "暂不考虑" }}</dd>
          </div>
          <div class="profile-editor__details-bio">
            <dt>简介</dt>
            <dd>{{ profile.bio || "未填写" }}</dd>
          </div>
        </dl>

        <p v-if="authorizationError" class="profile-editor__error" role="alert">{{ authorizationError }}</p>
        <p v-else-if="notice" class="profile-editor__notice" role="status">{{ notice }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.profile-editor {
  display: grid;
  grid-template-columns: minmax(0, 240px) minmax(0, 1fr);
  gap: 32px;
  min-width: 0;
}

.profile-editor__sidebar,
.profile-editor__content {
  min-width: 0;
}

.profile-editor__avatar {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 50%;
  object-fit: cover;
}

.profile-editor__avatar--fallback {
  color: var(--text-muted);
  background: var(--bg-subtle);
  font-size: clamp(48px, 10vw, 84px);
  font-weight: 600;
}

.profile-editor__identity {
  margin: 16px 0 0;
}

.profile-editor__identity h1,
.profile-editor__identity p,
.profile-editor__bio {
  margin: 0;
  overflow-wrap: anywhere;
}

.profile-editor__identity h1 {
  color: var(--text);
  font-size: 21px;
  font-weight: 600;
  line-height: 1.25;
}

.profile-editor__identity p {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1.4;
}

.profile-editor__bio {
  margin: 14px 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.profile-editor__sidebar :deep(button) {
  justify-content: center;
  gap: 6px;
}

.profile-editor__external {
  width: 100%;
}

.profile-editor__metadata {
  display: grid;
  gap: 8px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.profile-editor__metadata li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
}

.profile-editor__metadata svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--text-muted);
}

.profile-editor__metadata span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.profile-editor__content {
  align-self: start;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
}

.profile-editor__content-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-soft);
}

.profile-editor__content-header h2,
.profile-editor__content-header p,
.profile-editor__authorization h3,
.profile-editor__authorization p {
  margin: 0;
}

.profile-editor__content-header h2 {
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.profile-editor__content-header p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.profile-editor__authorization {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 16px 18px 0;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.profile-editor__authorization h3 {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.profile-editor__authorization p {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.profile-editor__device-flow {
  display: grid;
  justify-items: end;
  gap: 2px;
  flex: 0 0 auto;
}

.profile-editor__device-flow span,
.profile-editor__device-flow small {
  color: var(--text-muted);
  font-size: 11px;
}

.profile-editor__device-flow code {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.profile-editor__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  padding: 4px 18px 16px;
}

.profile-editor__details > div {
  min-width: 0;
  padding: 13px 0;
  border-bottom: 1px solid var(--border-soft);
}

.profile-editor__details > div:nth-child(odd):not(.profile-editor__details-bio) {
  padding-right: 18px;
}

.profile-editor__details > div:nth-child(even) {
  padding-left: 18px;
  border-left: 1px solid var(--border-soft);
}

.profile-editor__details dt {
  color: var(--text-muted);
  font-size: 11px;
}

.profile-editor__details dd {
  margin: 4px 0 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.profile-editor__details dd:where(:last-child) {
  min-height: 20px;
}

.profile-editor__details-bio {
  grid-column: 1 / -1;
}

.profile-editor__form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  padding: 18px;
}

.profile-editor__field {
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
}

.profile-editor__field label {
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
}

.profile-editor__field--switch {
  align-self: end;
  min-height: 52px;
  padding: 7px 0;
}

.profile-editor__field--bio {
  grid-column: 1 / -1;
}

.profile-editor__field--bio :deep(textarea) {
  min-height: 88px;
  resize: vertical;
}

.profile-editor__form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  grid-column: 1 / -1;
  padding-top: 2px;
}

.profile-editor__error,
.profile-editor__notice {
  margin: 0 18px 16px;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.profile-editor__error {
  color: var(--err);
}

.profile-editor__notice {
  color: var(--ok);
}

.profile-editor__load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  grid-column: 1 / -1;
  min-height: 104px;
}

.profile-editor__load-error h2,
.profile-editor__load-error p {
  margin: 0;
}

.profile-editor__load-error h2 {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

.profile-editor__load-error p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.profile-editor__sidebar--skeleton {
  min-height: 398px;
}

.profile-editor__content--skeleton {
  min-height: 372px;
  padding: 18px;
}

.profile-editor__skeleton {
  border-radius: 6px;
  background: var(--bg-subtle);
  animation: profile-skeleton 1.4s ease-in-out infinite alternate;
}

.profile-editor__skeleton--avatar {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 50%;
}

.profile-editor__skeleton--name {
  width: 68%;
  height: 24px;
  margin-top: 16px;
}

.profile-editor__skeleton--login {
  width: 45%;
  height: 18px;
  margin-top: 6px;
}

.profile-editor__skeleton--bio {
  width: 90%;
  height: 48px;
  margin-top: 18px;
}

.profile-editor__skeleton--heading {
  width: 31%;
  height: 20px;
  margin-bottom: 24px;
}

.profile-editor__skeleton--row {
  width: 100%;
  height: 42px;
  margin-top: 12px;
}

@keyframes profile-skeleton {
  from { opacity: 0.58; }
  to { opacity: 1; }
}

@media (max-width: 760px) {
  .profile-editor {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }

  .profile-editor__sidebar {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    column-gap: 16px;
    align-items: start;
  }

  .profile-editor__avatar,
  .profile-editor__skeleton--avatar {
    grid-row: 1 / span 3;
    width: 96px;
  }

  .profile-editor__identity,
  .profile-editor__skeleton--name {
    margin-top: 4px;
  }

  .profile-editor__bio,
  .profile-editor__metadata,
  .profile-editor__sidebar > :deep(button),
  .profile-editor__skeleton--bio {
    grid-column: 1 / -1;
  }

  .profile-editor__sidebar > :deep(button) {
    margin-top: 14px;
  }

  .profile-editor__metadata {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-editor__sidebar--skeleton {
    min-height: 210px;
  }

  .profile-editor__skeleton--login {
    margin-top: 0;
  }
}

@media (max-width: 540px) {
  .profile-editor__content-header,
  .profile-editor__authorization,
  .profile-editor__load-error {
    align-items: flex-start;
    flex-direction: column;
  }

  .profile-editor__content-header :deep(button),
  .profile-editor__authorization :deep(button) {
    width: 100%;
    justify-content: center;
  }

  .profile-editor__device-flow {
    justify-items: start;
  }

  .profile-editor__details,
  .profile-editor__form {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-editor__details > div:nth-child(odd):not(.profile-editor__details-bio),
  .profile-editor__details > div:nth-child(even) {
    padding-right: 0;
    padding-left: 0;
    border-left: 0;
  }

  .profile-editor__details-bio,
  .profile-editor__field--bio,
  .profile-editor__form-footer {
    grid-column: auto;
  }

  .profile-editor__metadata {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .profile-editor__skeleton {
    animation: none;
  }
}
</style>
