import { cleanup, render, waitFor } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useRepoDetailController } from "../src/composables/useRepoDetailController";
import { resetRepositoryRuntimeForTests } from "../src/composables/workspace/repositories";
import { resetRepoRefreshRuntimeForTests } from "../src/composables/workspace/repoRefreshEvents";
import { resetWorkspaceStateForTests, state } from "../src/composables/workspace/state";
import type { WorkspaceService } from "../src/composables/workspace/serviceLoader";
import type { ProjectLaunchCandidate, ProjectLaunchConfig } from "../src/services/workspace";
import { repoDetail, repoSummary } from "./fixtures/workspace";

const service = {
  getRepoDetail: vi.fn(),
  refreshRepoLanguageStats: vi.fn(),
  listWorkspaceTasks: vi.fn(),
  getRepoLaunchConfig: vi.fn(),
  listRepoLaunchCandidates: vi.fn(),
  getRepoLaunchStatus: vi.fn(),
  getRepoLaunchLogs: vi.fn(),
  listRepoLaunchHistory: vi.fn(),
  saveRepoLaunchConfig: vi.fn(),
  startRepoLaunch: vi.fn(),
  setActiveWorkspaceRepo: vi.fn(),
  enqueueRepoRefresh: vi.fn(),
};

vi.mock("../src/composables/workspace/serviceLoader", () => ({
  loadWorkspaceService: vi.fn(async () => service as unknown as WorkspaceService),
}));

type RepoDetailController = ReturnType<typeof useRepoDetailController>;

const candidate: ProjectLaunchCandidate = {
  command: "pnpm dev",
  label: "web dev",
  hint: "apps/web",
  kind: "package",
  cwd: "apps/web",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function renderControllerHarness(repoId: string) {
  let controller: RepoDetailController | null = null;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/repos/:repoId(.*)", component: { template: "<div />" } }],
  });
  await router.push(`/repos/${repoId}`);
  await router.isReady();

  const Harness = defineComponent({
    setup() {
      controller = useRepoDetailController();
      return () => h("div");
    },
  });

  const view = render(Harness, {
    global: {
      plugins: [router],
    },
  });

  if (!controller) throw new Error("Controller was not created");
  return { controller, ...view };
}

describe("repo detail launch controller", () => {
  let documentFocused = true;
  let documentVisibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    resetWorkspaceStateForTests();
    resetRepositoryRuntimeForTests();
    resetRepoRefreshRuntimeForTests();
    vi.clearAllMocks();
    vi.spyOn(document, "hasFocus").mockImplementation(() => documentFocused);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => documentVisibility);

    const summary = repoSummary("repo-a");
    state.repos = [summary];
    service.getRepoDetail.mockResolvedValue(repoDetail(summary));
    service.refreshRepoLanguageStats.mockResolvedValue(summary);
    service.listWorkspaceTasks.mockResolvedValue([]);
    service.getRepoLaunchConfig.mockResolvedValue(null);
    service.listRepoLaunchCandidates.mockResolvedValue([candidate]);
    service.getRepoLaunchStatus.mockImplementation(async (repoId: string) => ({
      repoId,
      state: "idle",
      pid: null,
      command: null,
      startedAt: null,
      exitCode: null,
      error: null,
    }));
    service.getRepoLaunchLogs.mockResolvedValue([]);
    service.listRepoLaunchHistory.mockResolvedValue([]);
    service.saveRepoLaunchConfig.mockImplementation(
      async (_repoId: string, command: string, cwd?: string | null): Promise<ProjectLaunchConfig> => ({
        command: command.trim(),
        cwd: cwd?.trim() ? cwd.trim() : null,
        source: "manual",
        updatedAt: 1,
      }),
    );
    service.startRepoLaunch.mockImplementation(async (repoId: string) => ({
      repoId,
      state: "running",
      pid: 1,
      command: state.launchConfigs[repoId]?.command ?? "",
      startedAt: 1,
      exitCode: null,
      error: null,
    }));
    service.setActiveWorkspaceRepo.mockResolvedValue(undefined);
    service.enqueueRepoRefresh.mockResolvedValue("remote-task");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads launch command candidates before repo detail loading finishes without starting statistics", async () => {
    const summary = repoSummary("repo-a");
    const pendingDetail = deferred<ReturnType<typeof repoDetail>>();
    service.getRepoDetail.mockReturnValueOnce(pendingDetail.promise);

    const { controller } = await renderControllerHarness("repo-a");

    await waitFor(() => {
      expect(controller.launchCommandOptions.value.some((option) => option.command === candidate.command)).toBe(true);
    });
    expect(service.listRepoLaunchCandidates).toHaveBeenCalledWith("repo-a");

    pendingDetail.resolve(repoDetail(summary));
    await waitFor(() => {
      expect(state.repoDetails["repo-a"]?.summary.id).toBe("repo-a");
    });
    expect(service.refreshRepoLanguageStats).not.toHaveBeenCalled();
  });

  it("preserves candidate cwd when an edited launch command is started", async () => {
    const { controller } = await renderControllerHarness("repo-a");
    let candidateValue: string | undefined;

    await waitFor(() => {
      candidateValue = controller.launchCommandOptions.value.find(
        (option) => option.command === candidate.command && option.candidate.cwd === candidate.cwd,
      )?.value;
      expect(candidateValue).toBeTruthy();
    });
    controller.selectLaunchCandidateByValue(candidateValue!);

    await waitFor(() => {
      expect(service.saveRepoLaunchConfig).toHaveBeenCalledWith("repo-a", "pnpm dev", "apps/web");
    });
    expect(state.launchConfigs["repo-a"]?.cwd).toBe("apps/web");

    controller.runLaunchCommand("pnpm dev --host 0.0.0.0");

    await waitFor(() => {
      expect(service.saveRepoLaunchConfig).toHaveBeenLastCalledWith(
        "repo-a",
        "pnpm dev --host 0.0.0.0",
        "apps/web",
      );
      expect(service.startRepoLaunch).toHaveBeenCalledWith("repo-a");
    });
    expect(state.launchConfigs["repo-a"]).toMatchObject({
      command: "pnpm dev --host 0.0.0.0",
      cwd: "apps/web",
    });
  });

  it("does not poll launch status while an idle repo detail page remains open", async () => {
    await renderControllerHarness("repo-a");
    await waitFor(() => {
      expect(service.getRepoLaunchStatus).toHaveBeenCalledTimes(1);
      expect(state.launchLoading).toBe(false);
    });
    vi.clearAllMocks();
    vi.useFakeTimers();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(service.getRepoLaunchStatus).not.toHaveBeenCalled();
    expect(service.getRepoLaunchLogs).not.toHaveBeenCalled();
  });

  it("self-schedules running terminal logs and pauses while the window is unfocused", async () => {
    const { controller } = await renderControllerHarness("repo-a");
    await waitFor(() => {
      expect(service.getRepoLaunchStatus).toHaveBeenCalledTimes(1);
      expect(state.launchLoading).toBe(false);
    });
    vi.clearAllMocks();
    vi.useFakeTimers();

    state.launchStatuses["repo-a"] = {
      repoId: "repo-a",
      workspaceId: null,
      contextRevision: 0,
      state: "running",
      pid: 1,
      command: "pnpm dev",
      startedAt: 1,
      exitCode: null,
      error: null,
    };
    controller.launchTerminalVisible.value = true;
    await nextTick();
    expect(controller.launchRunning.value).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(1);

    documentFocused = false;
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(1);

    documentFocused = true;
    service.getRepoLaunchStatus.mockResolvedValue({
      ...state.launchStatuses["repo-a"]!,
      state: "running",
    });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(service.getRepoLaunchStatus).toHaveBeenCalledTimes(1);
    expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(2);

    state.launchStatuses["repo-a"] = {
      ...state.launchStatuses["repo-a"]!,
      state: "exited",
      exitCode: 0,
    };
    await nextTick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(2);
  });

  it("stops terminal log refresh while the document is hidden and resumes when visible", async () => {
    const { controller } = await renderControllerHarness("repo-a");
    await waitFor(() => {
      expect(service.getRepoLaunchStatus).toHaveBeenCalledTimes(1);
      expect(state.launchLoading).toBe(false);
    });
    vi.clearAllMocks();
    vi.useFakeTimers();

    state.launchStatuses["repo-a"] = {
      repoId: "repo-a",
      workspaceId: null,
      contextRevision: 0,
      state: "running",
      pid: 1,
      command: "pnpm dev",
      startedAt: 1,
      exitCode: null,
      error: null,
    };
    controller.launchTerminalVisible.value = true;
    await nextTick();
    expect(controller.launchRunning.value).toBe(true);

    documentVisibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getRepoLaunchLogs).not.toHaveBeenCalled();

    documentVisibility = "visible";
    service.getRepoLaunchStatus.mockResolvedValue({
      ...state.launchStatuses["repo-a"]!,
      state: "running",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(service.getRepoLaunchStatus).toHaveBeenCalledTimes(1);
    expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(1);

    controller.launchTerminalVisible.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.getRepoLaunchLogs).toHaveBeenCalledTimes(1);
  });
});
