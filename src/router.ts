import {
  createRouter,
  createWebHistory,
  type RouterHistory,
} from "vue-router";
import AppShell from "./layouts/AppShell.vue";

const HomePage = () => import("./pages/Home.vue");
const SettingsPage = () => import("./pages/Settings.vue");
const RepoPage = () => import("./pages/RepoDetail.vue");
const CommitDetailPage = () => import("./pages/CommitDetail.vue");

export function createLiliaGithubRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      {
        path: "/",
        component: AppShell,
        children: [
          { path: "", component: HomePage },
          { path: "repos/:repoId(.*)/commits/:hash", component: CommitDetailPage },
          { path: "repos/:repoId(.*)", component: RepoPage },
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
}

export const router = createLiliaGithubRouter();
