import { ref } from "vue";
import type { RepoPullLocalChangesMode, RepoSummary } from "../services/workspace";
import { repoDisplayName } from "../utils/repoDisplay";

export type RepoLocalChangesDialogState = {
  readonly title: string;
  readonly repoName: string;
  readonly dirtyCount: number;
};

export function repoLocalDirtyCount(repo: Pick<RepoSummary, "stagedCount" | "unstagedCount" | "untrackedCount"> | null | undefined) {
  if (!repo) return 0;
  return repo.stagedCount + repo.unstagedCount + repo.untrackedCount;
}

export function useRepoLocalChangesPrompt() {
  const dialog = ref<RepoLocalChangesDialogState | null>(null);
  let resolveMode: ((mode: RepoPullLocalChangesMode | null) => void) | null = null;

  function request(title: string, repos: readonly RepoSummary[]) {
    const dirtyRepos = repos.filter((repo) => repoLocalDirtyCount(repo) > 0);
    if (!dirtyRepos.length) return Promise.resolve<RepoPullLocalChangesMode | null>("reject");
    resolveMode?.(null);
    return new Promise<RepoPullLocalChangesMode | null>((resolve) => {
      resolveMode = resolve;
      dialog.value = {
        title,
        repoName: dirtyRepos.length === 1 ? repoDisplayName(dirtyRepos[0]) : `${dirtyRepos.length} 个仓库`,
        dirtyCount: dirtyRepos.reduce((total, repo) => total + repoLocalDirtyCount(repo), 0),
      };
    });
  }

  function select(mode: Exclude<RepoPullLocalChangesMode, "reject">) {
    const resolve = resolveMode;
    resolveMode = null;
    dialog.value = null;
    resolve?.(mode);
  }

  function cancel() {
    const resolve = resolveMode;
    resolveMode = null;
    dialog.value = null;
    resolve?.(null);
  }

  return {
    dialog,
    request,
    select,
    cancel,
  };
}
