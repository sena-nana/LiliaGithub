import { createCachedAsyncComponent } from "../../../utils/asyncComponent";

const listModule = createCachedAsyncComponent(() => import("./RepoDiscussionList.vue"));
const detailModule = createCachedAsyncComponent(() => import("./RepoDiscussionDetail.vue"));
const createModule = createCachedAsyncComponent(() => import("./RepoDiscussionCreateForm.vue"));

export const RepoDiscussionList = listModule.component;
export const RepoDiscussionDetail = detailModule.component;
export const RepoDiscussionCreateForm = createModule.component;

export function preloadDiscussionView(view: "list" | "detail" | "create") {
  if (view === "detail") return detailModule.load();
  if (view === "create") return createModule.load();
  return listModule.load();
}
