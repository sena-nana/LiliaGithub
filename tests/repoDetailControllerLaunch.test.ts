import { cleanup, render, waitFor } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useRepoDetailController } from "../src/composables/useRepoDetailController";
import { resetRepositoryRuntimeForTests } from "../src/composables/workspace/repositories";
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
  beforeEach(() => {
    resetWorkspaceStateForTests();
    resetRepositoryRuntimeForTests();
    vi.clearAllMocks();

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
  });

  afterEach(() => {
    cleanup();
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
});
