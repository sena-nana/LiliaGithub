import { createLiliaRouter, LiliaSettingsPage } from "@lilia/ui";
import {
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from "vue-router";
import { invalidateSessionContextSnapshot } from "./composables/sessionContext";
import { createCachedAsyncModule } from "./utils/asyncModule";

const homePageModule = createCachedAsyncModule(() => import("./pages/Home.vue"));
const profilePageModule = createCachedAsyncModule(() => import("./pages/Profile.vue"));
const organizationPageModule = createCachedAsyncModule(() => import("./pages/Organization.vue"));
const repoPageModule = createCachedAsyncModule(() => import("./pages/RepoDetail.vue"));
const commitDetailPageModule = createCachedAsyncModule(() => import("./pages/CommitDetail.vue"));

const HomePage = () => homePageModule.load();
const ProfilePage = () => profilePageModule.load();
const OrganizationPage = () => organizationPageModule.load();
const RepoPage = () => repoPageModule.load();
const CommitDetailPage = () => commitDetailPageModule.load();

export const LILIA_GITHUB_ROUTES: RouteRecordRaw[] = [
  { path: "", component: HomePage },
  { path: "profile", name: "github-profile", component: ProfilePage },
  { path: "organizations/:login", name: "github-organization", component: OrganizationPage },
  {
    path: "organizations/:login/repositories",
    name: "github-organization-repositories",
    component: OrganizationPage,
  },
  { path: "repos/:repoId(.*)/commits/:hash", component: CommitDetailPage },
  { path: "repos/:repoId(.*)/files", component: RepoPage, meta: { repoTab: "files" } },
  { path: "repos/:repoId(.*)/changes", component: RepoPage, meta: { repoTab: "changes" } },
  { path: "repos/:repoId(.*)/history", component: RepoPage, meta: { repoTab: "history" } },
  { path: "repos/:repoId(.*)/stash", component: RepoPage, meta: { repoTab: "stash" } },
  { path: "repos/:repoId(.*)/branches", component: RepoPage, meta: { repoTab: "repo" } },
  { path: "repos/:repoId(.*)/run", component: RepoPage, meta: { repoTab: "run" } },
  { path: "repos/:repoId(.*)", component: RepoPage, meta: { repoTab: "repo" } },
  {
    path: "settings",
    component: LiliaSettingsPage,
    meta: { sidebar: "settings", lockSidebar: true, returnable: false },
  },
];

export function installLiliaGithubRouterGuards(router: Router) {
  router.beforeEach((to, from) => {
    if (to.fullPath !== from.fullPath) invalidateSessionContextSnapshot();
    return true;
  });
}

export function createLiliaGithubRouter(history: RouterHistory = createWebHistory()) {
  const router = createLiliaRouter(LILIA_GITHUB_ROUTES, undefined, history);
  installLiliaGithubRouterGuards(router);
  return router;
}

export const router = createLiliaGithubRouter();
