/**
 * Nana router — same page tree as the Tauri app for Home / Settings / Profile / Repo.
 * Static imports keep the IIFE free of async chunk loaders.
 */
import {
  createRouter,
  type RouterHistory,
  type RouteRecordRaw,
} from "vue-router";
import HomePage from "../pages/Home.vue";
import NanaProfilePage from "./NanaProfilePage.vue";
import NanaRepoPage from "./NanaRepoPage.vue";
import NanaSettingsPage from "./NanaSettingsPage.vue";

export const NANA_CRITICAL_ROUTES: RouteRecordRaw[] = [
  { path: "", name: "project-overview", component: HomePage },
  { path: "settings", component: NanaSettingsPage },
  { path: "profile", name: "github-profile", component: NanaProfilePage },
  {
    path: "repos/:repoId(.*)",
    name: "repo-skeleton",
    component: NanaRepoPage,
  },
];

export function createNanaCriticalRouter(history: RouterHistory) {
  return createRouter({
    history,
    routes: [
      {
        path: "/",
        children: NANA_CRITICAL_ROUTES,
      },
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });
}
