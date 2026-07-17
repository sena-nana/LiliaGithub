import { LiliaSettingsPage } from "./ui";
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from "vue-router";
import { invalidateSessionContextSnapshot } from "./composables/sessionContext";
import { recordContinueContextFromRoute } from "./services/controlCenter";
import { createCachedAsyncModule } from "./utils/asyncModule";

const personalHomePageModule = createCachedAsyncModule(() => import("./pages/PersonalHome.vue"));
const projectOverviewPageModule = createCachedAsyncModule(() => import("./pages/Home.vue"));
const discoveryPageModule = createCachedAsyncModule(() => import("./pages/Discovery.vue"));
const notificationsPageModule = createCachedAsyncModule(() => import("./pages/Notifications.vue"));
const profilePageModule = createCachedAsyncModule(() => import("./pages/Profile.vue"));
const organizationPageModule = createCachedAsyncModule(() => import("./pages/Organization.vue"));
const repoPageModule = createCachedAsyncModule(() => import("./pages/RepoDetail.vue"));
const commitDetailPageModule = createCachedAsyncModule(() => import("./pages/CommitDetail.vue"));

const PersonalHomePage = () => personalHomePageModule.load();
const ProjectOverviewPage = () => projectOverviewPageModule.load();
const DiscoveryPage = () => discoveryPageModule.load();
const NotificationsPage = () => notificationsPageModule.load();
const ProfilePage = () => profilePageModule.load();
const OrganizationPage = () => organizationPageModule.load();
const RepoPage = () => repoPageModule.load();
const CommitDetailPage = () => commitDetailPageModule.load();

export const LILIA_GITHUB_ROUTES: RouteRecordRaw[] = [
  { path: "", component: PersonalHomePage },
  { path: "overview", name: "project-overview", component: ProjectOverviewPage },
  { path: "discovery", name: "discovery", component: DiscoveryPage },
  { path: "notifications", name: "notifications", component: NotificationsPage },
  { path: "profile", name: "github-profile", component: ProfilePage },
  { path: "organizations/:login", name: "github-organization", component: OrganizationPage },
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
  },
];

export function installLiliaGithubRouterGuards(router: Router) {
  router.beforeEach((to, from) => {
    if (to.fullPath !== from.fullPath) invalidateSessionContextSnapshot();
    return true;
  });
  router.afterEach((to) => recordContinueContextFromRoute(to));
}

export function createLiliaGithubRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      {
        path: "/",
        children: LILIA_GITHUB_ROUTES,
      },
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });
  installLiliaGithubRouterGuards(router);
  return router;
}

export const router = createLiliaGithubRouter();
