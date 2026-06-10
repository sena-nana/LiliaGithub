import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from "vue-router";

function canReturnFrom(route: RouteLocationNormalizedLoaded): boolean {
  return route.path.startsWith("/") &&
    route.meta.sidebar !== "settings" &&
    route.meta.returnable !== false;
}

export function useRouteReturnTarget(defaultTarget = "/") {
  const route = useRoute();
  const router = useRouter();
  const previousRoute = ref<string | null>(null);

  const removeBeforeEach = router.beforeEach((to, from) => {
    if (to.meta.sidebar === "settings" && canReturnFrom(from)) {
      previousRoute.value = from.fullPath;
    }
  });

  const returnTo = computed(() => previousRoute.value || defaultTarget);

  function goBack() {
    router.push(returnTo.value);
  }

  onBeforeUnmount(() => {
    removeBeforeEach();
  });

  return {
    route,
    returnTo,
    goBack,
  };
}
