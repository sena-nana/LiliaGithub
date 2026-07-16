<script setup lang="ts">
import {
  BadgeCheck,
  BookOpen,
  Building2,
  ExternalLink,
  GitFork,
  Link,
  LoaderCircle,
  Mail,
  MapPin,
  Star,
  Users,
} from "@lucide/vue";
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import MarkdownReadme from "../repo/MarkdownReadme.vue";
import GitHubRepositoryStateNotice from "../github/GitHubRepositoryStateNotice.vue";
import { useComponentEpoch } from "../../composables/useComponentEpoch";
import { createLatestAsyncLoader } from "../../composables/useLatestAsyncLoader";
import { useWorkspace } from "../../composables/useWorkspace";
import {
  getGitHubOrganizationOverview,
  getGitHubOrganizationProfile,
  type GitHubOrganizationOverview,
  type GitHubOrganizationProfile,
  type GitHubOrganizationProfileView,
  type GitHubRepoSummary,
  type RepoSummary,
} from "../../services/workspace";
import {
  githubRepositoryIdentityKey,
  remoteRepoRoute,
  shortcutFromGitHubRepo,
} from "../../utils/remoteRepo";
import { repoRoute } from "../../utils/repoRoutes";
import { representativeReposByGitHubFullName } from "../../utils/repoWorktree";
import type { ReadmeLinkTarget } from "../../utils/readmeLinks";

const props = defineProps<{ login: string }>();
const router = useRouter();
const workspace = useWorkspace();
const componentEpoch = useComponentEpoch();
const profileLoader = createLatestAsyncLoader({ componentEpoch });
const overviewLoader = createLatestAsyncLoader({ componentEpoch });
const profile = ref<GitHubOrganizationProfile | null>(null);
const overview = ref<GitHubOrganizationOverview | null>(null);
const profileLoading = ref(false);
const overviewLoading = ref(false);
const profileError = ref<string | null>(null);
const overviewError = ref<string | null>(null);
const externalError = ref<string | null>(null);
const openingRepository = ref<string | null>(null);
const selectedView = ref<GitHubOrganizationProfileView>("member");

const organizationLogin = computed(() => props.login.trim());
const bindingIdentity = computed(() => {
  const binding = workspace.githubBinding.value;
  return binding
    ? `${binding.login.toLocaleLowerCase()}:${binding.boundAt}:${[...binding.scopes].sort().join(",")}`
    : "unbound";
});
const requestIdentity = computed(() => `${bindingIdentity.value}:${organizationLogin.value.toLocaleLowerCase()}`);
const localRepositoriesByFullName = computed(() =>
  representativeReposByGitHubFullName(workspace.state.repos),
);
const readmeLinkBase = computed(() => {
  const htmlUrl = overview.value?.readme.htmlUrl?.trim();
  if (!htmlUrl) return null;
  const slash = htmlUrl.lastIndexOf("/");
  return slash > "https://".length ? htmlUrl.slice(0, slash) : htmlUrl;
});

function resetOverview() {
  profileLoader.invalidate();
  overviewLoader.invalidate();
  profile.value = null;
  overview.value = null;
  profileLoading.value = false;
  overviewLoading.value = false;
  profileError.value = null;
  overviewError.value = null;
  externalError.value = null;
  openingRepository.value = null;
  selectedView.value = "member";
}

async function loadProfile() {
  const login = organizationLogin.value;
  const identity = requestIdentity.value;
  if (!workspace.githubBinding.value || !login || profileLoading.value) return;
  await profileLoader.run(identity, async (runId) => {
    profileLoading.value = true;
    profileError.value = null;
    try {
      const result = await getGitHubOrganizationProfile(login);
      if (!profileLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      profile.value = result;
    } catch {
      if (!profileLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      profileError.value = "暂时无法读取组织资料，请重试。";
    } finally {
      if (profileLoader.isCurrent(runId) && requestIdentity.value === identity) profileLoading.value = false;
    }
  });
}

async function loadOverview(view: GitHubOrganizationProfileView = selectedView.value) {
  const login = organizationLogin.value;
  const identity = requestIdentity.value;
  if (!workspace.githubBinding.value || !login || overviewLoading.value) return;
  selectedView.value = view;
  await overviewLoader.run(`${identity}:${view}`, async (runId) => {
    overviewLoading.value = true;
    overviewError.value = null;
    try {
      const result = await getGitHubOrganizationOverview(login, view);
      if (!overviewLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      overview.value = result;
      selectedView.value = result.effectiveView;
    } catch {
      if (!overviewLoader.isCurrent(runId) || requestIdentity.value !== identity) return;
      overviewError.value = "暂时无法读取组织内容，请重试。";
    } finally {
      if (overviewLoader.isCurrent(runId) && requestIdentity.value === identity) overviewLoading.value = false;
    }
  });
}

async function openExternal(url: string | null | undefined) {
  if (!url) return;
  externalError.value = null;
  try {
    await workspace.openUrl(url);
  } catch {
    if (componentEpoch.assertAlive()) externalError.value = "无法打开链接，请稍后重试。";
  }
}

function openReadmeLink(target: ReadmeLinkTarget) {
  if (target.kind === "external") void openExternal(target.href);
}

async function openRepository(repository: GitHubRepoSummary) {
  if (openingRepository.value) return;
  const identity = requestIdentity.value;
  const localRepository: RepoSummary | null = localRepositoriesByFullName.value.get(
    githubRepositoryIdentityKey(repository.fullName),
  ) ?? null;
  openingRepository.value = repository.fullName;
  externalError.value = null;
  try {
    if (localRepository) {
      await router.push(repoRoute(localRepository.id));
      return;
    }
    await workspace.rememberRemoteRepo(shortcutFromGitHubRepo(repository));
    if (!componentEpoch.assertAlive() || requestIdentity.value !== identity) return;
    await router.push(remoteRepoRoute(repository.fullName));
  } catch {
    if (componentEpoch.assertAlive() && requestIdentity.value === identity) {
      externalError.value = "无法打开仓库，请稍后重试。";
    }
  } finally {
    if (componentEpoch.assertAlive() && openingRepository.value === repository.fullName) {
      openingRepository.value = null;
    }
  }
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 1000 ? "compact" : "standard" }).format(value);
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "更新时间未知";
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sectionError(_error: string | null, fallback: string) {
  return fallback;
}

function repositoryAgentKey(repository: GitHubRepoSummary) {
  return repository.fullName.toLocaleLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function repositoryVisibilityLabel(repository: GitHubRepoSummary) {
  const visibility = repository.visibility?.trim().toLocaleLowerCase();
  if (visibility === "internal") return "Internal";
  return repository.private || visibility === "private" ? "Private" : "Public";
}

watch(
  requestIdentity,
  () => {
    resetOverview();
    if (workspace.githubBinding.value && organizationLogin.value) {
      void loadProfile();
      void loadOverview("member");
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  profileLoader.invalidate();
  overviewLoader.invalidate();
});
</script>

<template>
  <section class="organization-overview" aria-label="组织 Overview">
    <GitHubRepositoryStateNotice
      v-if="profileLoading && !profile"
      state="loading"
      message="正在加载组织资料…"
      agent-id="organization.profile.loading"
    />
    <GitHubRepositoryStateNotice
      v-else-if="profileError && !profile"
      state="error"
      retryable
      :message="profileError"
      agent-id="organization.profile.retry"
      @retry="loadProfile"
    />

    <template v-if="profile">
      <header class="organization-profile">
        <div class="organization-profile__identity">
          <img v-if="profile.avatarUrl" :src="profile.avatarUrl" alt="" class="organization-profile__avatar">
          <span v-else class="organization-profile__avatar organization-profile__avatar--fallback">
            <Building2 :size="34" aria-hidden="true" />
          </span>
          <div class="organization-profile__copy">
            <div class="organization-profile__title">
              <h1>{{ profile.name || profile.login }}</h1>
              <span v-if="profile.isVerified" class="organization-profile__verified" title="Verified">
                <BadgeCheck :size="15" aria-hidden="true" />Verified
              </span>
            </div>
            <p class="organization-profile__login">{{ profile.login }}</p>
            <p v-if="profile.description" class="organization-profile__description">{{ profile.description }}</p>
            <div class="organization-profile__meta">
              <span><Users :size="13" aria-hidden="true" />{{ formatCount(profile.followers) }} followers</span>
              <span><BookOpen :size="13" aria-hidden="true" />{{ formatCount(profile.publicRepoCount) }} public repositories</span>
              <span v-if="profile.location"><MapPin :size="13" aria-hidden="true" />{{ profile.location }}</span>
              <button
                v-if="profile.websiteUrl"
                type="button"
                data-agent-id="organization.profile.open-website"
                @click="openExternal(profile.websiteUrl)"
              >
                <Link :size="13" aria-hidden="true" />{{ profile.websiteUrl }}
              </button>
              <button
                v-if="profile.email"
                type="button"
                data-agent-id="organization.profile.open-email"
                @click="openExternal(`mailto:${profile.email}`)"
              >
                <Mail :size="13" aria-hidden="true" />{{ profile.email }}
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="ghost organization-profile__github"
          data-agent-id="organization.profile.open-github"
          @click="openExternal(profile.htmlUrl)"
        >
          <ExternalLink :size="14" aria-hidden="true" />
          在 GitHub 查看
        </button>
      </header>

      <div v-if="overview?.memberViewAvailable" class="organization-view-switch" aria-label="资料视图">
        <button
          type="button"
          :class="{ 'is-active': selectedView === 'public' }"
          data-agent-id="organization.view.public"
          :disabled="overviewLoading"
          @click="loadOverview('public')"
        >
          Public
        </button>
        <button
          type="button"
          :class="{ 'is-active': selectedView === 'member' }"
          data-agent-id="organization.view.member"
          :disabled="overviewLoading"
          @click="loadOverview('member')"
        >
          Member
        </button>
      </div>
    </template>

    <p v-if="externalError" class="organization-overview__error" role="alert">{{ externalError }}</p>

    <GitHubRepositoryStateNotice
      v-if="overviewLoading && !overview"
      state="loading"
      message="正在加载组织内容…"
      agent-id="organization.overview.loading"
    />
    <GitHubRepositoryStateNotice
      v-else-if="overviewError && !overview"
      state="error"
      retryable
      :message="overviewError"
      agent-id="organization.overview.retry"
      @retry="loadOverview()"
    />

    <div v-if="overview" class="organization-overview__layout" :aria-busy="overviewLoading">
      <main class="organization-overview__main">
        <section class="organization-section organization-readme" aria-labelledby="organization-readme-title">
          <div class="organization-section__heading">
            <h2 id="organization-readme-title">README</h2>
            <LoaderCircle v-if="overviewLoading" :size="13" aria-label="正在刷新" class="sb-spin" />
          </div>
          <div v-if="overview.readme.status === 'ready' && overview.readme.preview?.content" class="card organization-readme__content">
            <MarkdownReadme
              :content="overview.readme.preview.content"
              :images="overview.readme.preview.images"
              :current-readme-path="overview.readme.preview.path"
              :link-base-url="readmeLinkBase"
              @open-link="openReadmeLink"
            />
          </div>
          <GitHubRepositoryStateNotice
            v-else-if="overview.readme.status === 'unavailable'"
            state="error"
            retryable
            :message="sectionError(overview.readme.error, '暂时无法读取组织 README。')"
            agent-id="organization.readme.retry"
            @retry="loadOverview()"
          />
          <GitHubRepositoryStateNotice
            v-else
            state="empty"
            message="该组织尚未公开 README。"
            agent-id="organization.readme.empty"
          />
        </section>

        <section class="organization-section" aria-labelledby="organization-featured-title">
          <div class="organization-section__heading">
            <h2 id="organization-featured-title">
              {{ overview.featured.source === "pinned" ? "精选仓库" : "热门仓库" }}
            </h2>
          </div>
          <div v-if="overview.featured.status === 'ready' && overview.featured.items.length" class="organization-featured-grid">
            <button
              v-for="repository in overview.featured.items.slice(0, 6)"
              :key="repository.fullName"
              type="button"
              class="card organization-featured-card"
              :data-agent-id="`organization.featured.${repositoryAgentKey(repository)}`"
              :disabled="openingRepository !== null"
              @click="openRepository(repository)"
            >
              <span class="organization-featured-card__title">
                <BookOpen :size="14" aria-hidden="true" />
                <strong>{{ repository.name }}</strong>
                <span>{{ repositoryVisibilityLabel(repository) }}</span>
              </span>
              <span v-if="repository.description" class="organization-featured-card__description">{{ repository.description }}</span>
              <span class="organization-featured-card__meta">
                <span v-if="repository.language">{{ repository.language }}</span>
                <span v-if="repository.stargazersCount"><Star :size="12" aria-hidden="true" />{{ repository.stargazersCount }}</span>
                <span v-if="repository.forksCount"><GitFork :size="12" aria-hidden="true" />{{ repository.forksCount }}</span>
                <LoaderCircle v-if="openingRepository === repository.fullName" :size="13" aria-label="正在打开" class="sb-spin" />
              </span>
            </button>
          </div>
          <GitHubRepositoryStateNotice
            v-else-if="overview.featured.status === 'unavailable'"
            state="error"
            retryable
            :message="sectionError(overview.featured.error, '暂时无法读取精选仓库。')"
            agent-id="organization.featured.retry"
            @retry="loadOverview()"
          />
          <GitHubRepositoryStateNotice
            v-else
            state="empty"
            message="该组织暂无可展示的精选仓库。"
            agent-id="organization.featured.empty"
          />
        </section>

        <section class="organization-section" aria-labelledby="organization-recent-title">
          <div class="organization-section__heading">
            <h2 id="organization-recent-title">近期仓库</h2>
          </div>
          <div v-if="overview.recent.status === 'ready' && overview.recent.items.length" class="card organization-recent-list">
            <button
              v-for="repository in overview.recent.items.slice(0, 10)"
              :key="repository.fullName"
              type="button"
              class="organization-recent-row"
              :data-agent-id="`organization.recent.${repositoryAgentKey(repository)}`"
              :disabled="openingRepository !== null"
              @click="openRepository(repository)"
            >
              <span>
                <strong>{{ repository.name }}</strong>
                <small v-if="repository.description">{{ repository.description }}</small>
              </span>
              <span class="organization-recent-row__meta">
                <span v-if="repositoryVisibilityLabel(repository) !== 'Public'">
                  {{ repositoryVisibilityLabel(repository) }}
                </span>
                <span>{{ formatUpdatedAt(repository.updatedAt) }}</span>
                <LoaderCircle v-if="openingRepository === repository.fullName" :size="13" aria-label="正在打开" class="sb-spin" />
              </span>
            </button>
          </div>
          <GitHubRepositoryStateNotice
            v-else-if="overview.recent.status === 'unavailable'"
            state="error"
            retryable
            :message="sectionError(overview.recent.error, '暂时无法读取近期仓库。')"
            agent-id="organization.recent.retry"
            @retry="loadOverview()"
          />
          <GitHubRepositoryStateNotice
            v-else
            state="empty"
            message="暂无近期仓库。"
            agent-id="organization.recent.empty"
          />
        </section>
      </main>

      <aside class="organization-overview__sidebar" aria-labelledby="organization-members-title">
        <div class="organization-section__heading organization-members__heading">
          <h2 id="organization-members-title">成员</h2>
          <span v-if="overview.members.totalCount">{{ overview.members.totalCount }}</span>
        </div>
        <div v-if="overview.members.status === 'ready' && overview.members.items.length" class="organization-members" aria-label="组织成员">
          <button
            v-for="member in overview.members.items"
            :key="member.login"
            type="button"
            class="organization-member"
            :data-agent-id="`organization.members.${member.login.toLocaleLowerCase()}`"
            @click="openExternal(member.htmlUrl)"
          >
            <img v-if="member.avatarUrl" :src="member.avatarUrl" alt="">
            <span v-else class="organization-member__fallback"><Users :size="14" aria-hidden="true" /></span>
            <span><strong>{{ member.name || member.login }}</strong><small v-if="member.name">{{ member.login }}</small></span>
          </button>
        </div>
        <GitHubRepositoryStateNotice
          v-else-if="overview.members.status === 'unavailable'"
          state="error"
          compact
          retryable
          :message="sectionError(overview.members.error, '暂时无法读取成员。')"
          agent-id="organization.members.retry"
          @retry="loadOverview()"
        />
        <GitHubRepositoryStateNotice
          v-else
          state="empty"
          compact
          message="暂无公开成员。"
          agent-id="organization.members.empty"
        />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.organization-overview {
  min-width: 0;
}

.organization-profile,
.organization-profile__identity,
.organization-profile__title,
.organization-profile__meta,
.organization-profile__meta > span,
.organization-profile__meta > button,
.organization-profile__github,
.organization-section__heading,
.organization-featured-card__title,
.organization-featured-card__meta,
.organization-featured-card__meta > span,
.organization-recent-row,
.organization-recent-row__meta,
.organization-member {
  display: flex;
  align-items: center;
}

.organization-profile {
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 20px;
}

.organization-profile__identity {
  min-width: 0;
  align-items: flex-start;
  gap: 16px;
}

.organization-profile__avatar {
  width: 88px;
  height: 88px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  object-fit: cover;
}

.organization-profile__avatar--fallback {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.organization-profile__copy {
  min-width: 0;
}

.organization-profile__title {
  min-width: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.organization-profile__title h1,
.organization-profile__login,
.organization-profile__description {
  margin: 0;
}

.organization-profile__title h1 {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
}

.organization-profile__verified {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ok);
  font-size: 11px;
  font-weight: 600;
}

.organization-profile__login {
  margin-top: 1px;
  color: var(--text-muted);
  font-size: 14px;
}

.organization-profile__description {
  max-width: 680px;
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.organization-profile__meta {
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 10px;
  color: var(--text-muted);
  font-size: 11px;
}

.organization-profile__meta > span,
.organization-profile__meta > button {
  min-width: 0;
  gap: 5px;
}

.organization-profile__meta > button {
  max-width: 320px;
  overflow: hidden;
  padding: 0;
  border: 0;
  color: var(--text-muted);
  background: transparent;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-profile__meta > button:hover {
  color: var(--accent);
}

.organization-profile__github {
  flex: 0 0 auto;
  gap: 6px;
}

.organization-view-switch {
  display: flex;
  width: fit-content;
  gap: 2px;
  margin-bottom: 18px;
  padding: 2px;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  background: var(--bg-subtle);
}

.organization-view-switch button {
  min-height: 27px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  font-size: 11px;
}

.organization-view-switch button.is-active {
  color: var(--text);
  background: var(--bg-elev);
  box-shadow: 0 0 0 1px var(--border-soft);
}

.organization-overview__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  align-items: start;
  gap: 24px;
}

.organization-overview__main,
.organization-overview__sidebar {
  min-width: 0;
}

.organization-overview__main {
  display: grid;
  gap: 22px;
}

.organization-overview__sidebar {
  padding-left: 18px;
  border-left: 1px solid var(--border-soft);
}

.organization-section__heading {
  min-height: 28px;
  justify-content: space-between;
  gap: 8px;
}

.organization-section__heading h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.organization-section__heading > span {
  color: var(--text-muted);
  font-size: 11px;
}

.organization-readme__content {
  padding: 18px;
}

.organization-featured-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.organization-featured-card {
  min-width: 0;
  min-height: 112px;
  display: grid;
  align-content: space-between;
  gap: 9px;
  color: var(--text);
  text-align: left;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.organization-featured-card:hover,
.organization-featured-card:focus-visible {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.organization-featured-card__title {
  min-width: 0;
  gap: 7px;
}

.organization-featured-card__title strong {
  overflow: hidden;
  color: var(--accent);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-featured-card__title > span {
  margin-left: auto;
  padding: 1px 5px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 9px;
}

.organization-featured-card__description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.organization-featured-card__meta {
  flex-wrap: wrap;
  gap: 10px;
  color: var(--text-muted);
  font-size: 10px;
}

.organization-featured-card__meta > span {
  gap: 3px;
}

.organization-recent-list {
  padding: 4px 10px;
}

.organization-recent-row {
  width: 100%;
  min-width: 0;
  justify-content: space-between;
  gap: 14px;
  min-height: 54px;
  padding: 7px 2px;
  border: 0;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text);
  background: transparent;
  text-align: left;
}

.organization-recent-row:last-child {
  border-bottom: 0;
}

.organization-recent-row > span:first-child {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.organization-recent-row strong,
.organization-recent-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-recent-row strong {
  color: var(--accent);
  font-size: 12px;
}

.organization-recent-row small,
.organization-recent-row__meta {
  color: var(--text-muted);
  font-size: 10px;
}

.organization-recent-row__meta {
  flex: 0 0 auto;
  gap: 9px;
}

.organization-members {
  display: grid;
}

.organization-member {
  width: 100%;
  min-width: 0;
  gap: 8px;
  min-height: 42px;
  padding: 5px 2px;
  border: 0;
  color: var(--text);
  background: transparent;
  text-align: left;
}

.organization-member:hover strong,
.organization-member:focus-visible strong {
  color: var(--accent);
}

.organization-member img,
.organization-member__fallback {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 50%;
}

.organization-member img {
  object-fit: cover;
}

.organization-member__fallback {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.organization-member > span:last-child {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.organization-member strong,
.organization-member small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-member strong {
  font-size: 11px;
}

.organization-member small {
  color: var(--text-muted);
  font-size: 10px;
}

.organization-overview__error {
  margin: 0 0 10px;
  color: var(--err);
  font-size: 12px;
}

.sb-spin {
  animation: sb-spin 0.9s linear infinite;
}

@keyframes sb-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .organization-profile {
    align-items: flex-start;
    flex-direction: column;
  }

  .organization-profile__github {
    margin-left: 104px;
  }

  .organization-overview__layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .organization-overview__sidebar {
    padding-top: 18px;
    padding-left: 0;
    border-top: 1px solid var(--border-soft);
    border-left: 0;
  }

  .organization-members {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .organization-profile__avatar {
    width: 64px;
    height: 64px;
  }

  .organization-profile__github {
    width: 100%;
    justify-content: center;
    margin-left: 0;
  }

  .organization-featured-grid,
  .organization-members {
    grid-template-columns: minmax(0, 1fr);
  }

  .organization-recent-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .organization-featured-card,
  .sb-spin {
    transition: none;
    animation: none;
  }
}
</style>
