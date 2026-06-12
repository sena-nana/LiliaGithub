import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";
import { resetWorkspaceStateForTests } from "../src/composables/workspace/state";
import { clearGitHubRepoCache, resetWorkspaceFallbacksForTests } from "../src/services/workspace";

afterEach(async () => {
  cleanup();
  const { resetAuthFlowRuntimeForTests } = await import("../src/composables/workspace/auth");
  resetAuthFlowRuntimeForTests();
  resetWorkspaceStateForTests();
  resetWorkspaceFallbacksForTests();
  clearGitHubRepoCache();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
