import {
  createRouter,
  createWebHistory,
  type RouterHistory,
} from "vue-router";
import AppShell from "./layouts/AppShell.vue";

const HomePage = () => import("./pages/Home.vue");
const PluginsPage = () => import("./pages/Plugins.vue");
const SettingsPage = () => import("./pages/Settings.vue");
const RepoPage = () => import("./pages/RepoDetail.vue");

export function createLiliaGithubRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      {
        path: "/",
        component: AppShell,
        children: [
          { path: "", component: HomePage },
          { path: "repos/:repoId(.*)", component: RepoPage },
          { path: "plugins", component: PluginsPage },
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
