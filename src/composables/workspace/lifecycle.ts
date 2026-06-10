import { state } from "./state";
import { refreshRepos } from "./repositories";
import { loadWorkspaceService } from "./serviceLoader";

export async function initialize() {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  try {
    const service = await loadWorkspaceService();
    const [settings, bindingStatus] = await Promise.all([
      service.getWorkspaceSettings(),
      service.getGitHubBindingStatus(),
    ]);
    state.settings = settings;
    state.bindingStatus = bindingStatus;
    if (settings.workspaceRoot) {
      await refreshRepos();
    }
  } catch (err) {
    state.error = String(err);
  } finally {
    state.loading = false;
  }
}

export async function chooseWorkspaceRoot() {
  state.error = null;
  const service = await loadWorkspaceService();
  const picked = await service.pickWorkspaceRoot();
  if (!picked) return null;
  state.settings = await service.setWorkspaceRoot(picked);
  await refreshRepos();
  return picked;
}
