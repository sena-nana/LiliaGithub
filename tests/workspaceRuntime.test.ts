import { describe, expect, it } from "vitest";
import { resolveWorkspaceRuntimeForTests } from "../src/services/workspace";

describe("workspace runtime mode", () => {
  it("uses the development mock only when Vite dev runs outside Tauri", () => {
    expect(resolveWorkspaceRuntimeForTests({
      hasWindow: true,
      hasTauriInternals: false,
      isDev: true,
      isTest: false,
    })).toBe("mock");
  });

  it("keeps Tauri command invocation as the production runtime", () => {
    expect(resolveWorkspaceRuntimeForTests({
      hasWindow: true,
      hasTauriInternals: true,
      isDev: false,
      isTest: false,
    })).toBe("tauri");
  });

  it("does not silently use the mock in non-Tauri production builds", () => {
    expect(resolveWorkspaceRuntimeForTests({
      hasWindow: true,
      hasTauriInternals: false,
      isDev: false,
      isTest: false,
    })).toBe("unavailable");
  });
});
