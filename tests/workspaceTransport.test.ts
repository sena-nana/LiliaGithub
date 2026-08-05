import { describe, expect, it, vi } from "vitest";
import { WorkspaceCommandError } from "../src/services/workspace/errors";
import { createWorkspaceMockTransport } from "../src/services/workspace/mockTransport";
import {
  createRuntimeWorkspaceTransport,
  createWorkspaceHandlerTransport,
} from "../src/services/workspace/transport";

describe("workspace handler transport", () => {
  it("dispatches typed command arguments to the matching scenario handler", async () => {
    const transport = createWorkspaceHandlerTransport({
      system_open_url: async ({ url }) => {
        expect(url).toBe("https://github.com/sena-nana/LiliaGithub");
      },
    });

    await transport.invoke("system_open_url", {
      url: "https://github.com/sena-nana/LiliaGithub",
    });
  });

  it("reports unsupported scenario commands instead of succeeding as a no-op", async () => {
    const transport = createWorkspaceHandlerTransport({});

    await expect(transport.invoke("workspace_get_settings", undefined))
      .rejects.toThrow("Workspace transport does not implement workspace_get_settings");
  });

  it("selects one transport before dispatch and loads the mock only once", async () => {
    const mockHandler = vi.fn(async () => undefined);
    const tauriHandler = vi.fn(async () => undefined);
    const loadMockTransport = vi.fn(async () => createWorkspaceHandlerTransport({
      workspace_clear_startup_cache: mockHandler,
    }));
    const transport = createRuntimeWorkspaceTransport({
      probe: () => ({
        hasWindow: true,
        hasTauriInternals: false,
        isDev: true,
        isTest: false,
      }),
      loadMockTransport,
      tauriTransport: createWorkspaceHandlerTransport({
        workspace_clear_startup_cache: tauriHandler,
      }),
    });

    await transport.invoke("workspace_clear_startup_cache", undefined);
    await transport.invoke("workspace_clear_startup_cache", undefined);

    expect(mockHandler).toHaveBeenCalledTimes(2);
    expect(tauriHandler).not.toHaveBeenCalled();
    expect(loadMockTransport).toHaveBeenCalledTimes(1);
  });

  it("returns a structured unavailable error for system actions in mock mode", async () => {
    const transport = createWorkspaceMockTransport();

    const error = await transport.invoke("system_open_url", {
      url: "https://github.com/sena-nana/LiliaGithub",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WorkspaceCommandError);
    expect(error).toMatchObject({
      code: "workspace_action_unavailable",
      retryable: false,
      details: { command: "system_open_url", runtime: "mock" },
    });
  });
});
