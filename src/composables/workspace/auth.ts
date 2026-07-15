import { deviceFlow, applyBindingStatus, state } from "./state";
import { loadWorkspaceService } from "./serviceLoader";
import { copyText } from "./system";
import type { GitHubAuthPurpose, GitHubDeviceFlowPollResult } from "../../services/workspace";
import { reloadAccountWorkspace } from "./account";

let authPollTimer: ReturnType<typeof setTimeout> | null = null;
let authCountdownTimer: ReturnType<typeof setInterval> | null = null;
let authFlowVersion = 0;

function clearAuthTimers() {
  if (authPollTimer) {
    clearTimeout(authPollTimer);
    authPollTimer = null;
  }
  if (authCountdownTimer) {
    clearInterval(authCountdownTimer);
    authCountdownTimer = null;
  }
}

function updateAuthRemainingSeconds() {
  if (!deviceFlow.value) {
    state.authRemainingSeconds = null;
    return;
  }

  const remaining = Math.max(0, Math.ceil((deviceFlow.value.expiresAt - Date.now()) / 1000));
  state.authRemainingSeconds = remaining;
  if (remaining <= 0 && state.authFlowStatus === "pending") {
    state.error = "GitHub 设备码已过期，请重新发起绑定。";
    stopAuthFlow("expired");
  }
}

function startAuthCountdown() {
  if (authCountdownTimer) clearInterval(authCountdownTimer);
  updateAuthRemainingSeconds();
  authCountdownTimer = setInterval(updateAuthRemainingSeconds, 1000);
}

function scheduleAuthPoll(intervalSeconds: number) {
  if (!deviceFlow.value || state.authFlowStatus !== "pending") return;
  if (authPollTimer) clearTimeout(authPollTimer);

  authPollTimer = setTimeout(() => {
    authPollTimer = null;
    void pollAuthFlow();
  }, Math.max(1, intervalSeconds) * 1000);
}

function stopAuthFlow(status: "expired" | "error") {
  clearAuthTimers();
  state.authFlowStatus = status;
  if (status === "expired") state.authRemainingSeconds = 0;
}

function completeAuthFlow(result: GitHubDeviceFlowPollResult) {
  if (result.bindingStatus) applyBindingStatus(result.bindingStatus);
  clearAuthTimers();
  deviceFlow.value = null;
  state.error = null;
  state.authNotice = null;
  state.authFlowStatus = "idle";
  state.authRemainingSeconds = null;
}

async function copyAuthUserCode() {
  if (!deviceFlow.value) return;
  await copyText(deviceFlow.value.userCode);
  state.authNotice = "授权码已复制，请在 GitHub 授权页粘贴。";
}

export async function startAuthFlow(purpose: GitHubAuthPurpose = "binding") {
  authFlowVersion += 1;
  const currentVersion = authFlowVersion;
  clearAuthTimers();
  state.authLoading = true;
  state.error = null;
  state.authNotice = null;
  state.authFlowStatus = "idle";
  state.authRemainingSeconds = null;
  try {
    const service = await loadWorkspaceService();
    const flow = await service.startGitHubDeviceFlow(purpose);
    if (currentVersion !== authFlowVersion) return;
    deviceFlow.value = flow;
    state.authFlowStatus = "pending";
    updateAuthRemainingSeconds();
    await copyAuthUserCode();
    if (currentVersion !== authFlowVersion || !deviceFlow.value) return;
    await service.openUrl(deviceFlow.value.verificationUri);
    if (currentVersion !== authFlowVersion || !deviceFlow.value) return;
    startAuthCountdown();
    scheduleAuthPoll(deviceFlow.value.intervalSeconds);
  } catch (err) {
    if (currentVersion !== authFlowVersion) return;
    const message = String(err);
    state.error = message;
    stopAuthFlow("error");
  } finally {
    if (currentVersion === authFlowVersion) {
      state.authLoading = false;
    }
  }
}

export async function pollAuthFlow() {
  if (!deviceFlow.value) return null;
  if (state.authLoading) return null;

  const currentVersion = authFlowVersion;
  state.authLoading = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    const result = await service.pollGitHubDeviceFlow(
      deviceFlow.value.deviceCode,
      deviceFlow.value.intervalSeconds,
    );
    if (currentVersion !== authFlowVersion) return result;

    if (result.status === "authorized" && result.bindingStatus) {
      completeAuthFlow(result);
      if (state.settings) {
        try {
          await reloadAccountWorkspace();
        } catch (err) {
          state.error = String(err);
        }
      }
      return result;
    }

    if (result.status === "expired") {
      state.error = "GitHub 设备码已过期，请重新发起绑定。";
      stopAuthFlow("expired");
      return result;
    }

    if (result.error) {
      state.error = result.error;
      stopAuthFlow("error");
      return result;
    }

    state.authFlowStatus = "pending";
    if (deviceFlow.value) {
      deviceFlow.value = {
        ...deviceFlow.value,
        intervalSeconds: result.intervalSeconds,
      };
      updateAuthRemainingSeconds();
      scheduleAuthPoll(result.intervalSeconds);
    }
    return result;
  } catch (err) {
    if (currentVersion === authFlowVersion) {
      const message = String(err);
      state.error = message;
      stopAuthFlow("error");
    }
    return null;
  } finally {
    if (currentVersion === authFlowVersion) {
      state.authLoading = false;
    }
  }
}

export async function unbindGitHub() {
  const currentVersion = ++authFlowVersion;
  clearAuthTimers();
  state.authLoading = true;
  state.error = null;
  state.authNotice = null;
  state.authFlowStatus = "idle";
  state.authRemainingSeconds = null;
  deviceFlow.value = null;
  try {
    const service = await loadWorkspaceService();
    await service.unbindGitHub();
    if (currentVersion !== authFlowVersion) return;
    const bindingStatus = await service.getGitHubBindingStatus();
    if (currentVersion !== authFlowVersion) return;
    applyBindingStatus(bindingStatus);
    if (state.settings) await reloadAccountWorkspace();
  } catch (err) {
    if (currentVersion !== authFlowVersion) return;
    state.error = String(err);
    stopAuthFlow("error");
  } finally {
    if (currentVersion === authFlowVersion) {
      state.authLoading = false;
    }
  }
}

export function resetAuthFlowRuntimeForTests() {
  authFlowVersion += 1;
  clearAuthTimers();
}
