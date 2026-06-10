import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    sidebar?: "main" | "settings";
    lockSidebar?: boolean;
    returnable?: boolean;
  }
}
