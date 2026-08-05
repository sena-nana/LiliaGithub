import { computed, type ComputedRef } from "vue";
import { createKeyedAsyncResource } from "../../../composables/useKeyedAsyncResource";
import type { WorkspaceStore } from "../../../composables/workspace/store";
import type {
  GitHubIssueListOptions,
  GitHubPullRequestListOptions,
  GitHubAttachWorkflowArtifactAssetRequest,
  GitHubCreateReleaseRequest,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubRepoManagement,
  GitHubUpdateReleaseRequest,
  GitHubWorkflowRun,
  RepoFilePreview,
} from "../../../services/workspace/types";

interface RepoFeatureContext {
  workspace: WorkspaceStore;
  repoFullName: () => string | null | undefined;
  available: () => boolean;
  remoteDeleted: () => boolean;
}

interface RepoListFeatureContext<TOptions> extends RepoFeatureContext {
  options: () => TOptions;
  focus?: () => string | number | null | undefined;
}

function resourceKey(
  context: RepoFeatureContext,
  section: string,
  state: unknown = null,
  focus: unknown = null,
) {
  return JSON.stringify({
    sessionRevision: context.workspace.sessionContext.revision,
    workspaceRevision: context.workspace.contextRevision.value,
    binding: context.workspace.githubBinding.value?.login ?? null,
    repo: context.repoFullName()?.trim() ?? "",
    section,
    state,
    focus,
  });
}

function useRepoListResource<TItem, TOptions>(
  section: string,
  context: RepoListFeatureContext<TOptions>,
  loader: (repoFullName: string, options: TOptions, force: boolean) => Promise<TItem[]>,
) {
  const resource = createKeyedAsyncResource<string, TItem[]>({
    sessionContext: context.workspace.sessionContext,
  });
  const items: ComputedRef<TItem[]> = computed(
    () => (resource.state.value.data as TItem[] | null) ?? [],
  );
  const loading = computed(() => resource.state.value.status === "loading" || resource.state.value.refreshing);
  const error = computed(() => resource.state.value.error == null ? null : String(resource.state.value.error));
  let dataScopeKey: string | null = null;

  function key() {
    return resourceKey(context, section, context.options(), context.focus?.());
  }

  function scopeKey() {
    return resourceKey(context, section, context.options());
  }

  async function load(force = false) {
    const repoFullName = context.repoFullName()?.trim();
    if (!repoFullName || context.remoteDeleted() || !context.available()) return null;
    const options = context.options();
    const currentKey = key();
    const currentScopeKey = scopeKey();
    if (!force && resource.state.value.key === currentKey && resource.state.value.data !== null) {
      return resource.state.value.data as TItem[];
    }
    if (
      resource.state.value.key !== currentKey &&
      dataScopeKey === currentScopeKey &&
      resource.state.value.data !== null
    ) {
      resource.set(currentKey, resource.state.value.data as TItem[]);
    }
    dataScopeKey = currentScopeKey;
    return resource.load(
      currentKey,
      () => loader(repoFullName, options, force),
      { preserveData: true, reusePending: !force },
    );
  }

  function replace(next: TItem[]) {
    resource.set(key(), next);
  }

  function update(updater: (current: TItem[]) => TItem[]) {
    const currentKey = key();
    const previous = (resource.state.value.data as TItem[] | null) ?? [];
    if (!resource.update(currentKey, (current) => updater(current ?? []))) {
      resource.set(currentKey, updater(previous));
    }
  }

  return { resource, items, loading, error, load, replace, updateItems: update, invalidate: resource.invalidate };
}

export function useRepoIssuesController(
  context: RepoListFeatureContext<GitHubIssueListOptions>,
) {
  const list = useRepoListResource("issues", context, async (repo, options, force) => {
    const service = await context.workspace.github.service();
    return force
      ? service.listGitHubIssues(repo, options, { forceRefresh: true })
      : service.listGitHubIssues(repo, options);
  });

  async function create(request: Parameters<Awaited<ReturnType<typeof context.workspace.github.service>>["createGitHubIssue"]>[1]) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const created = await service.createGitHubIssue(repo, request);
    list.updateItems((items) => [created, ...items.filter((item) => item.number !== created.number)]);
    return created;
  }

  async function updateIssue(number: number, request: Parameters<Awaited<ReturnType<typeof context.workspace.github.service>>["updateGitHubIssue"]>[2]) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const updated = await service.updateGitHubIssue(repo, number, request);
    list.updateItems((items) => items.map((item) => item.number === updated.number ? updated : item));
    return updated;
  }

  return { ...list, create, updateIssue };
}

export function useRepoPullsController(
  context: RepoListFeatureContext<GitHubPullRequestListOptions>,
) {
  const list = useRepoListResource("pulls", context, async (repo, options, force) => {
    const service = await context.workspace.github.service();
    return force
      ? service.listGitHubPullRequests(repo, options, { forceRefresh: true })
      : service.listGitHubPullRequests(repo, options);
  });

  async function create(request: Parameters<Awaited<ReturnType<typeof context.workspace.github.service>>["createGitHubPullRequest"]>[1]) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const created = await service.createGitHubPullRequest(repo, request);
    list.updateItems((items) => [created, ...items.filter((item) => item.number !== created.number)]);
    return created;
  }

  async function updatePull(number: number, request: Parameters<Awaited<ReturnType<typeof context.workspace.github.service>>["updateGitHubPullRequest"]>[2]) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const updated = await service.updateGitHubPullRequest(repo, number, request);
    list.updateItems((items) => items.map((item) => item.number === updated.number ? updated : item));
    return updated;
  }

  async function merge(number: number, request: Parameters<Awaited<ReturnType<typeof context.workspace.github.service>>["mergeGitHubPullRequest"]>[2]) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const updated = await service.mergeGitHubPullRequest(repo, number, request);
    list.updateItems((items) => items.map((item) => item.number === updated.number ? updated : item));
    return updated;
  }

  return { ...list, create, updatePull, merge };
}

export function useRepoActionsController(
  context: RepoFeatureContext & { state: () => unknown; focus: () => number | null | undefined },
) {
  return useRepoListResource<GitHubWorkflowRun, unknown>("actions", {
    ...context,
    options: context.state,
    focus: context.focus,
  }, async (repo, _state, force) => {
    const service = await context.workspace.github.service();
    return force
      ? service.listGitHubWorkflowRuns(repo, 20, { forceRefresh: true })
      : service.listGitHubWorkflowRuns(repo, 20);
  });
}

export function useRepoReleasesController(
  context: RepoFeatureContext & { filter: () => unknown; focus: () => string | null | undefined },
) {
  const list = useRepoListResource<GitHubRelease, unknown>("release", {
    ...context,
    options: context.filter,
    focus: context.focus,
  }, async (repo, _filter, force) => {
    const service = await context.workspace.github.service();
    return force
      ? service.listGitHubReleases(repo, { forceRefresh: true })
      : service.listGitHubReleases(repo);
  });

  function upsert(release: GitHubRelease) {
    list.updateItems((items) => [release, ...items.filter((item) => item.id !== release.id)]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)));
  }

  function remove(id: number) {
    list.updateItems((items) => items.filter((item) => item.id !== id));
  }

  async function create(request: GitHubCreateReleaseRequest) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const release = await service.createGitHubRelease(repo, request);
    upsert(release);
    return release;
  }

  async function updateRelease(id: number, request: GitHubUpdateReleaseRequest) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const release = await service.updateGitHubRelease(repo, id, request);
    upsert(release);
    return release;
  }

  async function deleteRelease(id: number) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return false;
    const service = await context.workspace.github.service();
    await service.deleteGitHubRelease(repo, id);
    remove(id);
    return true;
  }

  function upsertAsset(releaseId: number, asset: GitHubReleaseAsset) {
    list.updateItems((items) => items.map((release) => release.id === releaseId ? {
      ...release,
      assets: [asset, ...release.assets.filter((candidate) => candidate.id !== asset.id)],
    } : release));
  }

  async function uploadAsset(releaseId: number, filePath: string) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const asset = await service.uploadGitHubReleaseAsset(repo, releaseId, filePath);
    upsertAsset(releaseId, asset);
    return asset;
  }

  async function attachArtifact(request: GitHubAttachWorkflowArtifactAssetRequest) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const asset = await service.attachGitHubWorkflowArtifactAsset(repo, request);
    upsertAsset(request.releaseId, asset);
    return asset;
  }

  async function deleteAsset(releaseId: number, assetId: number) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return false;
    const service = await context.workspace.github.service();
    await service.deleteGitHubReleaseAsset(repo, releaseId, assetId);
    list.updateItems((items) => items.map((release) => release.id === releaseId ? {
      ...release,
      assets: release.assets.filter((asset) => asset.id !== assetId),
    } : release));
    return true;
  }

  return {
    ...list,
    upsert,
    remove,
    create,
    updateRelease,
    deleteRelease,
    uploadAsset,
    attachArtifact,
    deleteAsset,
  };
}

export function useRepoSettingsController(context: RepoFeatureContext) {
  const resource = createKeyedAsyncResource<string, GitHubRepoManagement>({
    sessionContext: context.workspace.sessionContext,
  });
  const data: ComputedRef<GitHubRepoManagement | null> = computed(
    () => resource.state.value.data as GitHubRepoManagement | null,
  );
  const loading = computed(() => resource.state.value.status === "loading" || resource.state.value.refreshing);
  const error = computed(() => resource.state.value.error == null ? null : String(resource.state.value.error));

  function key() {
    return resourceKey(context, "settings");
  }

  async function load(force = false) {
    const repo = context.repoFullName()?.trim();
    if (!repo || context.remoteDeleted() || !context.available()) return null;
    const currentKey = key();
    if (!force && resource.state.value.key === currentKey && resource.state.value.data !== null) {
      return resource.state.value.data as GitHubRepoManagement;
    }
    return resource.load(currentKey, async () => {
      const service = await context.workspace.github.service();
      return force
        ? service.getGitHubRepoManagement(repo, { forceRefresh: true })
        : service.getGitHubRepoManagement(repo);
    }, { preserveData: true, reusePending: !force });
  }

  function replace(value: GitHubRepoManagement) {
    resource.set(key(), value);
  }

  async function update(request: Parameters<Awaited<ReturnType<typeof context.workspace.github.service>>["updateGitHubRepoSettings"]>[1]) {
    const repo = context.repoFullName()?.trim();
    if (!repo) return null;
    const service = await context.workspace.github.service();
    const value = await service.updateGitHubRepoSettings(repo, request);
    replace(value);
    return value;
  }

  return { resource, data, loading, error, load, replace, update, invalidate: resource.invalidate };
}

export function useRepoFilesHistoryController(context: {
  workspace: WorkspaceStore;
  repoId: () => string;
  provider: () => string;
  available: () => boolean;
}) {
  const resource = createKeyedAsyncResource<string, RepoFilePreview | null>({
    sessionContext: context.workspace.sessionContext,
  });
  const preview = computed(() => resource.state.value.data ?? null);
  const loading = computed(() => resource.state.value.status === "loading" || resource.state.value.refreshing);
  const error = computed(() => resource.state.value.error == null ? null : String(resource.state.value.error));

  async function loadReadme(force = false) {
    const repoId = context.repoId();
    const key = JSON.stringify({
      sessionRevision: context.workspace.sessionContext.revision,
      workspaceRevision: context.workspace.contextRevision.value,
      repo: repoId,
      section: "files-history",
      provider: context.provider(),
      focus: "README.md",
    });
    if (!force && resource.state.value.key === key && resource.state.value.status === "ready") {
      return resource.state.value.data as RepoFilePreview | null;
    }
    return resource.load(key, async () => {
      if (!context.available()) return null;
      const service = await context.workspace.github.service();
      const entries = force
        ? await service.listRepoFiles(repoId, null, undefined, { forceRefresh: true })
        : await service.listRepoFiles(repoId, null, undefined, { forceRefresh: false });
      if (!entries.some((entry) => entry.kind === "file" && entry.path === "README.md")) return null;
      return service.getRepoFilePreview(
        repoId,
        "README.md",
        undefined,
        { forceRefresh: force },
      );
    }, { preserveData: true, reusePending: !force });
  }

  return { resource, preview, loading, error, loadReadme, invalidate: resource.invalidate };
}
