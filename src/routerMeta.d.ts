import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    repoTab?: "files" | "repo" | "changes" | "history" | "stash" | "run";
  }
}
