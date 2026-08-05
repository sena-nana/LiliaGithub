import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterEach } from "vitest";
import { clearHomeGitHubOverviewSnapshot } from "../src/pages/homeOverviewCache";
import { resetWorkspaceFallbacksForTests } from "../src/services/workspace";

afterEach(async () => {
  cleanup();
  clearHomeGitHubOverviewSnapshot();
  await resetWorkspaceFallbacksForTests();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-corners");
  document.documentElement.style.removeProperty("--app-corner-radius");
});
