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
import { UiButton, UiInput, UiSwitch, UiTextarea } from "../../ui";
import { computed, reactive, ref, watch } from "vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import type {
  GitHubAccountProfile,
  GitHubProfileReadmeSection,
} from "../../services/workspace";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";
import GitHubRepositoryStateNotice from "../github/GitHubRepositoryStateNotice.vue";
import MarkdownReadme from "../repo/MarkdownReadme.vue";

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
const readmeLoader = createLatestAsyncLoader({ componentEpoch });
const profile = ref<GitHubAccountProfile | null>(null);
const readme = ref<GitHubProfileReadmeSection | null>(null);
const draft = reactive<ProfileDraft>(blankDraft());
const baseline = ref("");
const profileLoading = ref(false);
const readmeLoading = ref(false);
const saving = ref(false);
const editing = ref(false);
const authorizing = ref(false);
const openingGitHub = ref(false);
const error = ref<string | null>(null);
const readmeError = ref<string | null>(null);
const notice = ref<string | null>(null);

const binding = computed(() => workspace.githubBinding.value);
const canEdit = computed(() => binding.value?.scopes.includes("user") === true);
const dirty = computed(() => JSON.stringify(draft) !== baseline.value);
const authPending = computed(() =>
  authorizing.value
  || workspace.state.authLoading
  || workspace.state.authFlowStatus === "pending",
);
const readmeLinkBase = computed(() => {
  const htmlUrl = readme.value?.htmlUrl?.trim();
  if (!htmlUrl) return null;
  const slash = htmlUrl.lastIndexOf("/");
  return slash > "https://".length ? htmlUrl.slice(0, slash) : htmlUrl;
});
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
    profileLoading.value = true;
    error.value = null;
    notice.value = null;
    try {
      const next = await workspace.getAccountProfile();
      if (profileLoader.isCurrent(runId) && accountContextKey() === contextKey) applyProfile(next);
    } catch (err) {
      if (profileLoader.isCurrent(runId) && accountContextKey() === contextKey) error.value = profileError(err);
    } finally {
      if (profileLoader.isCurrent(runId)) profileLoading.value = false;
    }
  });
}

async function loadReadme() {
  const contextKey = accountContextKey();
  if (!contextKey || readmeLoading.value) return;
  await readmeLoader.run(contextKey, async (runId) => {
    readmeLoading.value = true;
    readmeError.value = null;
    if (readme.value?.status === "unavailable") readme.value = null;
    try {
      const next = await workspace.getAccountReadme();
      if (!readmeLoader.isCurrent(runId) || accountContextKey() !== contextKey) return;
      readme.value = next;
    } catch {
      if (!readmeLoader.isCurrent(runId) || accountContextKey() !== contextKey) return;
      readme.value = null;
      readmeError.value = "暂时无法读取个人 README，请重试。";
    } finally {
      if (readmeLoader.isCurrent(runId)) readmeLoading.value = false;
    }
  });
}

function beginEditing() {
  if (!profile.value || !canEdit.value || profileLoading.value || saving.value) return;
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
    await workspace.startAuthFlow();
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

async function openReadmeLink(target: ReadmeLinkTarget) {
  if (target.kind !== "external") return;
  readmeError.value = null;
  try {
    await workspace.openUrl(target.href);
  } catch {
    if (componentEpoch.assertAlive()) readmeError.value = "无法打开 README 链接，请稍后重试。";
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
    readmeLoader.invalidate();
    profileLoading.value = false;
    readmeLoading.value = false;
    saving.value = false;
    editing.value = false;
    openingGitHub.value = false;
    profile.value = null;
    readme.value = null;
    readmeError.value = null;
    Object.assign(draft, blankDraft());
    baseline.value = JSON.stringify(draft);
    void loadProfile();
    void loadReadme();
  },
  { immediate: true },
);
</script>

<template>
  <div class="profile-editor" data-agent-id="profile.editor">
    <aside class="profile-editor__sidebar" data-agent-id="profile.sidebar" aria-label="GitHub 个人资料">
      <template v-if="profileLoading && !profile">
        <div class="profile-editor__skeleton profile-editor__skeleton--avatar" />
        <div class="profile-editor__skeleton profile-editor__skeleton--name" />
        <div class="profile-editor__skeleton profile-editor__skeleton--login" />
        <div class="profile-editor__skeleton profile-editor__skeleton--bio" />
      </template>

      <div v-else-if="!profile" class="profile-editor__load-error card" role="alert">
        <div>
          <h2>无法加载个人资料</h2>
          <p>{{ error || "暂时无法读取 GitHub 公开资料，请稍后重试。" }}</p>
        </div>
        <UiButton size="sm" agent-id="profile.retry" :busy="profileLoading" @click="loadProfile">
          重新加载
        </UiButton>
      </div>

      <template v-else>
        <div class="profile-editor__summary">
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
        </div>

        <p v-if="profile.bio && !editing" class="profile-editor__bio">{{ profile.bio }}</p>

        <div class="profile-editor__actions">
          <UiButton
            v-if="canEdit && !editing"
            size="sm"
            agent-id="profile.edit"
            :disabled="profileLoading || saving"
            @click="beginEditing"
          >
            编辑资料
          </UiButton>
          <UiButton
            size="sm"
            agent-id="profile.open-github"
            :busy="openingGitHub"
            :disabled="openingGitHub"
            @click="openGitHubProfile"
          >
            <ExternalLink :size="14" aria-hidden="true" />
            在 GitHub 查看
          </UiButton>
        </div>

        <div v-if="!canEdit" class="profile-editor__authorization" data-agent-id="profile.authorization" role="status">
          <div>
            <h2>{{ authPending ? "等待 GitHub 授权" : "授权后可编辑资料" }}</h2>
            <p v-if="authPending">请在 GitHub 授权页输入设备码并确认。</p>
            <p v-else>当前绑定仅支持查看公开资料。</p>
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
            补全授权
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
          <div class="profile-editor__field profile-editor__field--bio">
            <label for="profile-bio">简介</label>
            <UiTextarea id="profile-bio" v-model="draft.bio" agent-id="profile.bio" :disabled="saving" />
          </div>
          <div class="profile-editor__field profile-editor__field--switch">
            <UiSwitch
              v-model="draft.hireable"
              label="愿意接受工作机会"
              control-position="end"
              block
              agent-id="profile.hireable"
              :disabled="saving"
            />
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
              保存
            </UiButton>
          </div>
        </form>

        <ul v-else class="profile-editor__metadata" aria-label="公开资料摘要">
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

        <p v-if="authorizationError" class="profile-editor__error" role="alert">{{ authorizationError }}</p>
        <p v-else-if="notice" class="profile-editor__notice" role="status">{{ notice }}</p>
      </template>
    </aside>

    <section class="profile-editor__readme" data-agent-id="profile.readme" aria-labelledby="profile-readme-title">
      <header class="profile-editor__readme-header">
        <div>
          <h2 id="profile-readme-title">README</h2>
          <p>{{ binding?.login }} 的个人 README</p>
        </div>
      </header>

      <GitHubRepositoryStateNotice
        v-if="readmeLoading && !readme"
        state="loading"
        message="正在加载个人 README…"
        agent-id="profile.readme.loading"
      />
      <template v-else-if="readme?.status === 'ready' && readme.preview?.content">
        <div class="card profile-editor__readme-content">
          <MarkdownReadme
            :content="readme.preview.content"
            :images="readme.preview.images"
            :current-readme-path="readme.preview.path"
            :link-base-url="readmeLinkBase"
            @open-link="openReadmeLink"
          />
        </div>
        <p v-if="readmeError" class="profile-editor__error" role="alert">{{ readmeError }}</p>
      </template>
      <GitHubRepositoryStateNotice
        v-else-if="readmeError || readme?.status === 'unavailable'"
        state="error"
        retryable
        message="暂时无法读取个人 README，请重试。"
        agent-id="profile.readme.retry"
        @retry="loadReadme"
      />
      <GitHubRepositoryStateNotice
        v-else
        state="empty"
        message="尚未公开个人 README。"
        agent-id="profile.readme.empty"
      />
    </section>
  </div>
</template>

<style scoped>
.profile-editor {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  align-items: start;
  gap: 32px;
  min-width: 0;
}

.profile-editor__sidebar,
.profile-editor__readme {
  min-width: 0;
}

.profile-editor__summary {
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
  min-width: 0;
  margin-top: 16px;
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
  margin-top: 14px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.profile-editor__actions {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.profile-editor__actions :deep(button) {
  width: 100%;
  justify-content: center;
  gap: 6px;
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

.profile-editor__authorization {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.profile-editor__authorization h2,
.profile-editor__authorization p {
  margin: 0;
}

.profile-editor__authorization h2 {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.profile-editor__authorization p {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.profile-editor__authorization :deep(button) {
  width: 100%;
  justify-content: center;
}

.profile-editor__device-flow {
  display: grid;
  gap: 2px;
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

.profile-editor__form {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border-soft);
}

.profile-editor__field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.profile-editor__field label {
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
}

.profile-editor__field--bio :deep(textarea) {
  min-height: 84px;
  resize: vertical;
}

.profile-editor__field--switch {
  padding: 3px 0;
}

.profile-editor__form-footer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-top: 2px;
}

.profile-editor__form-footer :deep(button) {
  width: 100%;
  justify-content: center;
}

.profile-editor__error,
.profile-editor__notice {
  margin: 14px 0 0;
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
  display: grid;
  align-content: start;
  gap: 14px;
  min-height: 160px;
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

.profile-editor__load-error :deep(button) {
  width: 100%;
  justify-content: center;
}

.profile-editor__readme {
  align-self: start;
}

.profile-editor__readme-header {
  min-height: 46px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-soft);
}

.profile-editor__readme-header h2,
.profile-editor__readme-header p {
  margin: 0;
}

.profile-editor__readme-header h2 {
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.profile-editor__readme-header p {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.profile-editor__readme > :not(.profile-editor__readme-header) {
  margin-top: 12px;
}

.profile-editor__readme-content {
  min-height: 180px;
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
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border-soft);
  }

  .profile-editor__summary {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    align-items: start;
    gap: 16px;
  }

  .profile-editor__avatar,
  .profile-editor__skeleton--avatar {
    width: 96px;
  }

  .profile-editor__identity,
  .profile-editor__skeleton--name {
    margin-top: 4px;
  }

  .profile-editor__metadata {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-editor__skeleton--login {
    margin-top: 0;
  }

  .profile-editor__skeleton--bio {
    width: 100%;
  }
}

@media (max-width: 540px) {
  .profile-editor__metadata {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-editor__readme-content {
    padding: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .profile-editor__skeleton {
    animation: none;
  }
}
</style>
