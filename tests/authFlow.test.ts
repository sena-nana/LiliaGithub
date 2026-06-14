import { describe, expect, it, vi } from "vitest";
import { state, deviceFlow, githubBinding } from "../src/composables/workspace/state";
import { startAuthFlow } from "../src/composables/workspace/auth";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type { GitHubBindingStatus } from "../src/services/workspace";

const service = {
  startGitHubDeviceFlow: vi.fn(),
  pollGitHubDeviceFlow: vi.fn(),
  openUrl: vi.fn(),
};

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

const boundStatus: GitHubBindingStatus = {
  state: "bound",
  clientIdConfigured: true,
  clientIdSource: "bundled",
  binding: {
    login: "octo-user",
    avatarUrl: null,
    boundAt: 1_785_000_000,
    scopes: ["repo", "workflow", "read:user", "delete_repo"],
    clientIdSource: "bundled",
  },
};

describe("GitHub 设备码授权", () => {
  it("启动后按 interval 自动轮询并在成功后收口到已绑定态", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));
    service.startGitHubDeviceFlow.mockResolvedValue({
      deviceCode: "device-code",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 600_000,
      intervalSeconds: 2,
    });
    service.openUrl.mockResolvedValue(undefined);
    service.pollGitHubDeviceFlow
      .mockResolvedValueOnce({
        status: "pending",
        intervalSeconds: 3,
        bindingStatus: null,
        error: null,
      })
      .mockResolvedValueOnce({
        status: "authorized",
        intervalSeconds: 3,
        bindingStatus: boundStatus,
        error: null,
      });

    await startAuthFlow();

    expect(service.openUrl).toHaveBeenCalledWith("https://github.com/login/device");
    expect(state.authFlowStatus).toBe("pending");
    expect(state.authRemainingSeconds).toBe(600);
    expect(deviceFlow.value?.userCode).toBe("ABCD-1234");

    await vi.advanceTimersByTimeAsync(2_000);

    expect(service.pollGitHubDeviceFlow).toHaveBeenCalledTimes(1);
    expect(service.pollGitHubDeviceFlow).toHaveBeenLastCalledWith("device-code", 2);
    expect(state.authFlowStatus).toBe("pending");
    expect(deviceFlow.value?.intervalSeconds).toBe(3);

    await vi.advanceTimersByTimeAsync(3_000);

    expect(service.pollGitHubDeviceFlow).toHaveBeenCalledTimes(2);
    expect(service.pollGitHubDeviceFlow).toHaveBeenLastCalledWith("device-code", 3);
    expect(deviceFlow.value).toBeNull();
    expect(githubBinding.value?.login).toBe("octo-user");
    expect(state.authFlowStatus).toBe("idle");
    expect(state.authRemainingSeconds).toBeNull();

    vi.useRealTimers();
  });
});
