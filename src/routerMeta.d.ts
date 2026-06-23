import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    repoTab?: "files" | "repo" | "changes" | "history" | "stash" | "run";
    sidebar?: "main" | "settings";
    lockSidebar?: boolean;
    returnable?: boolean;
  }
}
