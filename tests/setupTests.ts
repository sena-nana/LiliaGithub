import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";
import { resetWorkspaceStateForTests } from "../src/composables/workspace/state";
import { resetWorkspaceFallbacksForTests } from "../src/services/workspace";

afterEach(() => {
  cleanup();
  resetWorkspaceStateForTests();
  resetWorkspaceFallbacksForTests();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
