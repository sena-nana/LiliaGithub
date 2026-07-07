import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";
import { clearFrontendBackgroundTasksForTests } from "../src/composables/useBackgroundTasks";
import { resetWorkspaceStateForTests } from "../src/composables/workspace/state";
import { clearHomeGitHubOverviewSnapshot } from "../src/pages/homeOverviewCache";
import { clearGitHubRepoCache, resetWorkspaceFallbacksForTests } from "../src/services/workspace";

afterEach(async () => {
  cleanup();
  const { resetAuthFlowRuntimeForTests } = await import("../src/composables/workspace/auth");
  const { resetRepositoryRuntimeForTests } = await import("../src/composables/workspace/repositories");
  resetAuthFlowRuntimeForTests();
  resetRepositoryRuntimeForTests();
  clearFrontendBackgroundTasksForTests();
  resetWorkspaceStateForTests();
  clearHomeGitHubOverviewSnapshot();
  await resetWorkspaceFallbacksForTests();
  clearGitHubRepoCache();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-corners");
  document.documentElement.style.removeProperty("--app-corner-radius");
});
