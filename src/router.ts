import {
  createRouter,
  createWebHistory,
  type RouterHistory,
} from "vue-router";
import { invalidateSessionContextSnapshot } from "./composables/sessionContext";
import AppShell from "./layouts/AppShell.vue";
import { createCachedAsyncModule } from "./utils/asyncModule";

const homePageModule = createCachedAsyncModule(() => import("./pages/Home.vue"));
const settingsPageModule = createCachedAsyncModule(() => import("./pages/Settings.vue"));
const repoPageModule = createCachedAsyncModule(() => import("./pages/RepoDetail.vue"));
const commitDetailPageModule = createCachedAsyncModule(() => import("./pages/CommitDetail.vue"));

const HomePage = () => homePageModule.load();
const SettingsPage = () => settingsPageModule.load();
const RepoPage = () => repoPageModule.load();
const CommitDetailPage = () => commitDetailPageModule.load();

export function createLiliaGithubRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      {
        path: "/",
        component: AppShell,
        children: [
          { path: "", component: HomePage },
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
            component: SettingsPage,
            meta: { sidebar: "settings", lockSidebar: true, returnable: false },
          },
        ],
      },
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });
  router.beforeEach((to, from) => {
    if (to.fullPath !== from.fullPath) invalidateSessionContextSnapshot();
    return true;
  });
  return router;
}

export const router = createLiliaGithubRouter();
