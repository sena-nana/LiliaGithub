import { deviceFlow, applyBindingStatus, state } from "./state";
import { loadWorkspaceService } from "./serviceLoader";

export async function startAuthFlow() {
  state.authLoading = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    deviceFlow.value = await service.startGitHubDeviceFlow();
    await service.openUrl(deviceFlow.value.verificationUri);
  } catch (err) {
    state.error = String(err);
  } finally {
    state.authLoading = false;
  }
}

export async function pollAuthFlow() {
  if (!deviceFlow.value) return null;
  state.authLoading = true;
  try {
    const service = await loadWorkspaceService();
    const result = await service.pollGitHubDeviceFlow(
      deviceFlow.value.deviceCode,
      deviceFlow.value.intervalSeconds,
    );
    if (result.status === "authorized" && result.bindingStatus) {
      applyBindingStatus(result.bindingStatus);
      deviceFlow.value = null;
    }
    return result;
  } finally {
    state.authLoading = false;
  }
}
