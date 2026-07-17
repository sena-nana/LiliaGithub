import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installAgentDebugHarness,
  uninstallAgentDebugHarness,
  type LiliaAgentDebugApi,
} from "../src/ui";
import { installLiliaGithubAgentDebugCompat } from "../src/agentDebug/compat";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function debugWindow() {
  return window as typeof window & {
    __liliaAgentDebug?: LiliaAgentDebugApi;
    __liliaGithubAgentDebug?: LiliaAgentDebugApi;
  };
}

describe("agent debug compatibility", () => {
  afterEach(() => {
    uninstallAgentDebugHarness();
    document.body.innerHTML = "";
    delete debugWindow().__liliaGithubAgentDebug;
    delete debugWindow().__liliaAgentDebug;
  });

  it("does not expose the LiliaGithub alias before the shared harness is installed", () => {
    const cleanup = installLiliaGithubAgentDebugCompat();

    expect(debugWindow().__liliaGithubAgentDebug).toBeUndefined();

    cleanup();
  });

  it("exposes the shared LiliaUI debug API through the LiliaGithub alias", () => {
    document.body.innerHTML = `
      <button data-agent-id="repo.sync.button">同步</button>
      <input data-agent-id="repo.search.input" value="" />
    `;
    const sharedApi = installAgentDebugHarness({ enabled: true });
    const cleanup = installLiliaGithubAgentDebugCompat();
    const snapshot = debugWindow().__liliaGithubAgentDebug?.observe();

    expect(debugWindow().__liliaGithubAgentDebug).toBe(sharedApi);
    expect(snapshot?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "repo.sync.button", disabled: false, tagName: "button" }),
        expect.objectContaining({ agentId: "repo.search.input", disabled: false, tagName: "input" }),
      ]),
    );

    cleanup();
  });

  it("acts on targets through the compatibility alias", async () => {
    const clicked = vi.fn();
    document.body.innerHTML = `
      <button data-agent-id="repo.refresh.button">刷新</button>
      <textarea data-agent-id="repo.note.input"></textarea>
    `;
    document.querySelector("button")?.addEventListener("click", clicked);
    installAgentDebugHarness({ enabled: true });
    const cleanup = installLiliaGithubAgentDebugCompat();
    const api = debugWindow().__liliaGithubAgentDebug;

    await api?.act({ type: "click", target: "repo.refresh.button" });
    await api?.act({ type: "type", target: "repo.note.input", text: "hello" });

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.querySelector("[data-agent-id='repo.note.input']"));
    expect(document.querySelector<HTMLTextAreaElement>("[data-agent-id='repo.note.input']")?.value).toBe("hello");

    cleanup();
  });

  it("records invoke traces in the shared debug log", async () => {
    installAgentDebugHarness({ enabled: true });
    const cleanup = installLiliaGithubAgentDebugCompat();
    const { recordAgentDebugInvokeEnd, recordAgentDebugInvokeStart } = await import("../src/agentDebug/compat");

    const trace = recordAgentDebugInvokeStart("workspace_refresh_repos", {});
    recordAgentDebugInvokeEnd(trace, "success", { ok: true });

    expect(debugWindow().__liliaAgentDebug?.getRecentErrors()).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          command: "workspace_refresh_repos",
          kind: "invoke",
          status: "success",
        }),
        type: "action",
      }),
    );

    cleanup();
  });
});
