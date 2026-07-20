import { describe, expect, it } from "vitest";
import { isLocalRepositoryConfirmedMissing } from "../src/utils/workspaceTruth";

const verifiedMissing = {
  repoId: "repo-a",
  remoteRepo: false,
  loading: false,
  scanning: false,
  activeWorkspaceId: "workspace-a",
  rootsAvailable: true,
  verifiedWorkspaceId: "workspace-a",
  repoPresent: false,
};

describe("workspace repository truth", () => {
  it("只有当前工作区可用根完成成功扫描后才确认本地仓库缺失", () => {
    expect(isLocalRepositoryConfirmedMissing(verifiedMissing)).toBe(true);
    expect(isLocalRepositoryConfirmedMissing({ ...verifiedMissing, rootsAvailable: false })).toBe(false);
    expect(isLocalRepositoryConfirmedMissing({ ...verifiedMissing, verifiedWorkspaceId: null })).toBe(false);
    expect(isLocalRepositoryConfirmedMissing({ ...verifiedMissing, verifiedWorkspaceId: "workspace-b" })).toBe(false);
    expect(isLocalRepositoryConfirmedMissing({ ...verifiedMissing, scanning: true })).toBe(false);
    expect(isLocalRepositoryConfirmedMissing({ ...verifiedMissing, repoPresent: true })).toBe(false);
  });
});
