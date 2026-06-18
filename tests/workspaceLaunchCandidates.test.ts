import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { listRepoLaunchCandidates } from "../src/services/workspace";

const ROOT_SCRIPT_PRIORITY = ["tauri:dev", "dev", "start", "serve", "preview", "docs:dev"] as const;

function packageManagerCommand(script: string) {
  const packageManager = String(packageJson.packageManager ?? "npm").split("@")[0] || "npm";
  return packageManager === "npm" ? `npm run ${script}` : `${packageManager} ${script}`;
}

function rootScriptRank(script: string) {
  const index = ROOT_SCRIPT_PRIORITY.indexOf(script as typeof ROOT_SCRIPT_PRIORITY[number]);
  return index === -1 ? ROOT_SCRIPT_PRIORITY.length : index;
}

describe("workspace launch candidates", () => {
  it("mock 模式返回根 package.json 的完整 scripts 列表", async () => {
    const expectedScripts = Object.keys(packageJson.scripts)
      .sort((left, right) => rootScriptRank(left) - rootScriptRank(right) || left.localeCompare(right));
    const candidates = await listRepoLaunchCandidates("LiliaGithub");

    expect(candidates.map((candidate) => candidate.command)).toEqual(
      expectedScripts.map((script) => packageManagerCommand(script)),
    );
    expect(candidates.find((candidate) => candidate.label === "verify")).toMatchObject({
      command: packageManagerCommand("verify"),
      hint: "package.json script",
      kind: "package",
      cwd: null,
    });
  });
});
