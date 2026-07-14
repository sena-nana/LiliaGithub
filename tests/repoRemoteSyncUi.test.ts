import { cleanup, fireEvent, render, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import RepoRemoteSyncDialog from "../src/components/repo/RepoRemoteSyncDialog.vue";
import RepoSyncResultDialog from "../src/components/repo/RepoSyncResultDialog.vue";
import type { RepoRemoteSyncConfig, RepoSyncOperationResult } from "../src/services/workspace";
import { conflictState, repoSummary } from "./fixtures/workspace";

const config: RepoRemoteSyncConfig = {
  remotes: [
    {
      name: "origin",
      fetchUrl: "https://github.com/example/repo.git",
      pushUrl: "https://github.com/example/repo.git",
      current: true,
    },
    {
      name: "backup",
      fetchUrl: "ssh://git@example.com/repo.git",
      pushUrl: "ssh://git@example.com/repo.git",
      current: false,
    },
  ],
  policy: null,
  resolvedPolicy: {
    primaryRemote: "origin",
    pullRemotes: ["origin"],
    pushRemotes: ["origin"],
  },
  validationErrors: [],
};

afterEach(() => cleanup());

describe("remote sync UI", () => {
  it("saves real remote roles and keeps the selected primary in pull sources", async () => {
    const view = render(RepoRemoteSyncDialog, {
      props: {
        open: true,
        config,
        loading: false,
        saving: false,
        error: null,
      },
      global: { stubs: { transition: false } },
    });
    const primaryOptions = screen.getAllByRole("radio", { name: /设为主远端/ });
    await fireEvent.click(primaryOptions[1]);
    await fireEvent.click(screen.getByRole("switch", { name: "origin 用于拉取" }));
    await fireEvent.click(screen.getByRole("switch", { name: "backup 用于推送" }));
    await fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(view.emitted("save")?.[0]).toEqual([{
      primaryRemote: "backup",
      pullRemotes: ["backup"],
      pushRemotes: ["origin", "backup"],
    }]);
  });

  it("retries only remote push failures from a structured partial result", async () => {
    const result: RepoSyncOperationResult = {
      status: "partial",
      message: "部分远端推送失败",
      summary: repoSummary("repo-a"),
      conflicts: conflictState(),
      steps: [
        { remote: "origin", operation: "push", status: "success", message: "完成" },
        { remote: "mirror", operation: "push", status: "error", message: "认证失败" },
        { remote: "backup", operation: "fetch", status: "error", message: "网络错误" },
        {
          remote: "",
          operation: "restore",
          status: "error",
          message: "stash 还原失败",
        },
      ],
    };
    const view = render(RepoSyncResultDialog, {
      props: { result, retrying: false },
      global: { stubs: { transition: false } },
    });
    expect(screen.getByText("本地修改")).toBeInTheDocument();
    expect(screen.getByText("还原")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重试失败推送（1）" }));

    expect(view.emitted("retryPush")?.[0]).toEqual([["mirror"]]);
  });
});
