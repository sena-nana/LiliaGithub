import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceRuntimeForTests } from "../src/services/workspace";
import { WORKSPACE_COMMAND_MANIFEST } from "../src/services/workspace/manifest";

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

  it("keeps the workspace command manifest aligned with the Tauri handler", () => {
    const lib = readFileSync(resolve("src-tauri/src/lib.rs"), "utf-8");
    const handler = lib.match(/tauri::generate_handler!\[(?<body>[\s\S]*?)\]\)/)?.groups?.body ?? "";
    const tauriCommands = [...handler.matchAll(/workspace::[a-z_]+::([a-z0-9_]+)/g)]
      .map((match) => match[1])
      .sort();
    const manifestCommands = Object.values(WORKSPACE_COMMAND_MANIFEST)
      .map((entry) => entry.command)
      .sort();

    expect(manifestCommands).toEqual(tauriCommands);
    for (const [key, entry] of Object.entries(WORKSPACE_COMMAND_MANIFEST)) {
      expect(entry.command).toBe(key);
    }
  });
});
