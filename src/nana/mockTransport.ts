/**
 * Sync-friendly mock workspace transport for Nana (no Tauri, no dynamic fallback import).
 * Returns Promises so it satisfies WorkspaceTransport; payload matches WorkspaceBootstrap.
 * P1b: seed demo repos so Home overview + SecondaryPanel have visible rows.
 *
 * Privileged mutations (`workspace_switch`, secret reads) must go through Rust
 * `__nanaHost` capability gates — Vue UI cannot enlarge PermissionPolicy.
 */
import type { ContributionIdentity } from "../services/workspace";
import type { WorkspaceTransport } from "../services/workspace/transport";

export interface NanaMockTransportOptions {
  startReady?: boolean;
}

function rustHostCall(name: string, args: unknown[]): unknown {
  const host = (globalThis as { __nanaHost?: { call?: (n: string, a: unknown[]) => unknown } })
    .__nanaHost;
  if (!host || typeof host.call !== "function") {
    throw new Error(`Rust host API unavailable for ${name}`);
  }
  return host.call(name, args);
}

function defaultAccountPreferences() {
  return {
    repositoryScope: { kind: "all" as const },
    repositorySort: { key: "updated" as const, direction: "desc" as const },
    issues: { state: "open" as const, sort: "updated" as const, direction: "desc" as const },
    pullRequests: { state: "open" as const, sort: "updated" as const, direction: "desc" as const },
    actions: { state: "all" as const, sort: "updated" as const, direction: "desc" as const },
  };
}

function demoRepos() {
  const now = Date.now();
  return [
    {
      id: "repo-1",
      name: "NanaUI",
      fullName: "nana-demo/NanaUI",
      path: "/tmp/demo-workspace/NanaUI",
      remoteUrl: "https://github.com/nana-demo/NanaUI.git",
      githubFullName: "nana-demo/NanaUI",
      defaultBranch: "main",
      updatedAt: now - 3_600_000,
      lastOpenedAt: now - 600_000,
      isFavorite: true,
      groupId: null,
      syncIssue: null,
      language: "Rust",
      private: false,
      archived: false,
      languageStats: [
        { language: "Rust", bytes: 420_000, lines: 9800 },
        { language: "TypeScript", bytes: 48_000, lines: 1400 },
        { language: "CSS", bytes: 12_000, lines: 420 },
      ],
      languageStatsUpdatedAt: now - 600_000,
    },
    {
      id: "repo-2",
      name: "LiliaGithub",
      fullName: "nana-demo/LiliaGithub",
      path: "/tmp/demo-workspace/LiliaGithub",
      remoteUrl: "https://github.com/nana-demo/LiliaGithub.git",
      githubFullName: "nana-demo/LiliaGithub",
      defaultBranch: "main",
      updatedAt: now - 86_400_000,
      lastOpenedAt: now - 3_600_000,
      isFavorite: false,
      groupId: null,
      syncIssue: null,
      language: "TypeScript",
      private: false,
      archived: false,
      languageStats: [
        { language: "TypeScript", bytes: 118_000, lines: 3120 },
        { language: "Vue", bytes: 86_000, lines: 1910 },
        { language: "CSS", bytes: 18_000, lines: 640 },
      ],
      languageStatsUpdatedAt: now - 3_600_000,
    },
  ];
}

/** Sparse year of contribution days so CalendarHeatmap has level path geometry. */
function demoContributionDays() {
  const days: { date: string; count: number }[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 370);
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    // Mild weekday bias + deterministic speckles for green levels.
    const seed = (cursor.getUTCFullYear() * 372 + cursor.getUTCMonth() * 31 + cursor.getUTCDate()) % 17;
    let count = 0;
    if (dow !== 0 && dow !== 6) {
      if (seed < 3) count = 1;
      else if (seed < 6) count = 2;
      else if (seed === 7) count = 4;
      else if (seed === 11) count = 8;
    } else if (seed === 2) {
      count = 1;
    }
    days.push({ date: key, count });
  }
  return days;
}

function bootstrap(startReady: boolean) {
  const binding = startReady
    ? {
        login: "nana-demo",
        userId: 1,
        avatarUrl: "",
        name: "Nana Demo",
        clientIdSource: "mock",
        scopes: ["repo"],
        boundAt: Date.now(),
      }
    : null;

  const root = {
    id: "root-1",
    path: "/tmp/demo-workspace",
    available: true,
    unavailableReason: null,
  };

  const activeWorkspace = {
    id: "ws-demo",
    name: "demo-workspace",
    roots: startReady ? [root] : [],
    primaryRootId: startReady ? root.id : null,
    recentContext: null,
    viewPreferences: {
      sidebarRepositorySort: "updated:desc",
      collapsedGroupIds: [],
    },
  };

  const settings = {
    workspaceRoot: startReady ? root.path : null,
    githubBinding: binding,
    accountPreferences: defaultAccountPreferences(),
    projectLaunchConfigs: {},
    repoSyncPreferences: {},
    repoRemoteSyncPolicies: {},
    hiddenRepoIds: [],
    managedRepoIds: startReady ? ["repo-1", "repo-2"] : [],
    systemGitRepoIds: [],
    repoBindings: {},
    favoriteRepoIds: startReady ? ["repo-1"] : [],
    repoGroups: [],
    organizationGroupingResolvedRepoIds: [],
    remoteRepoShortcuts: [],
    recentLocalRepos: startReady ? demoRepos() : [],
    localContributionCache: {},
    contributionIdentities: [] as ContributionIdentity[],
    workspaceCatalog: [activeWorkspace],
    activeWorkspaceId: "ws-demo",
    activeWorkspace,
  };

  const demo = startReady ? demoRepos() : [];
  return {
    settings,
    contextRevision: 1,
    startupCache: startReady
      ? {
          workspaceId: "ws-demo",
          rootsFingerprint: "demo-workspace",
          workspaceRoot: root.path,
          bindingLogin: "nana-demo",
          reposById: Object.fromEntries(
            demo.map((repo) => [
              repo.id,
              {
                summary: repo,
                cachedAt: Date.now(),
                remoteCheckedAt: Date.now(),
              },
            ]),
          ),
          contributions: {
            days: demoContributionDays(),
            meta: {
              repoCount: 2,
              requestedRepoCount: 2,
              repoLimit: 30,
              truncated: false,
              skippedRepoCount: 0,
              refreshedAt: Date.now(),
            },
            cachedAt: Date.now(),
          },
        }
      : null,
    repos: demo,
  };
}

export function createNanaMockWorkspaceTransport(
  options: NanaMockTransportOptions = {},
): WorkspaceTransport {
  let ready = !!options.startReady;
  let boot = bootstrap(ready);

  return {
    async invoke(command, args) {
      switch (String(command)) {
        case "workspace_get_bootstrap":
          return boot as never;
        case "workspace_get_settings":
          return boot.settings as never;
        case "workspace_read_startup_cache":
          return null as never;
        case "workspace_clear_startup_cache":
          return undefined as never;
        case "github_get_binding_status":
          return {
            state: ready && boot.settings.githubBinding ? "bound" : "unbound",
            clientIdConfigured: true,
            clientIdSource: "mock",
            binding: boot.settings.githubBinding,
          } as never;
        case "workspace_pick_root":
          ready = true;
          boot = bootstrap(true);
          return boot.settings.workspaceRoot as never;
        case "workspace_create": {
          ready = true;
          boot = bootstrap(true);
          if (args && typeof args === "object" && "name" in args) {
            const name = String((args as { name?: string }).name || "demo-workspace");
            boot.settings.activeWorkspace.name = name;
            boot.settings.workspaceCatalog[0].name = name;
          }
          return boot as never;
        }
        case "workspace_switch": {
          const workspaceId =
            args && typeof args === "object" && "workspaceId" in args
              ? String((args as { workspaceId?: string }).workspaceId || "ws-demo")
              : "ws-demo";
          // Capability-gated on the Rust host (workspace.switch). Demo catalog stays local.
          rustHostCall("workspaceSwitch", [workspaceId]);
          boot.settings.activeWorkspaceId = workspaceId;
          return boot as never;
        }
        case "workspace_update_view_preferences":
          if (args && typeof args === "object") {
            boot.settings.activeWorkspace.viewPreferences = {
              ...boot.settings.activeWorkspace.viewPreferences,
              ...(args as object),
            };
          }
          return boot.settings.activeWorkspace.viewPreferences as never;
        case "workspace_update_account_preferences": {
          const preferences =
            args && typeof args === "object" && "preferences" in args
              ? (args as { preferences?: typeof boot.settings.accountPreferences }).preferences
              : null;
          if (preferences) {
            boot.settings.accountPreferences = {
              ...boot.settings.accountPreferences,
              ...preferences,
              repositoryScope:
                preferences.repositoryScope ?? boot.settings.accountPreferences.repositoryScope,
              repositorySort: {
                ...boot.settings.accountPreferences.repositorySort,
                ...(preferences.repositorySort ?? {}),
              },
            };
          }
          return boot.settings as never;
        }
        case "workspace_set_contribution_identities": {
          const identities =
            args && typeof args === "object" && "identities" in args
              ? (args as { identities?: Array<{ name?: string; email?: string }> }).identities
              : [];
          boot.settings.contributionIdentities = Array.isArray(identities)
            ? identities
                .map((item) => ({
                  name: item?.name?.trim() || null,
                  email: item?.email?.trim().toLowerCase() || null,
                }))
                .filter((item) => item.name || item.email)
            : [];
          return boot.settings as never;
        }
        case "workspace_rename": {
          const workspaceId =
            args && typeof args === "object" && "workspaceId" in args
              ? String((args as { workspaceId?: string }).workspaceId || "")
              : "";
          const name =
            args && typeof args === "object" && "name" in args
              ? String((args as { name?: string }).name || "").trim()
              : "";
          if (name && workspaceId) {
            if (boot.settings.activeWorkspace.id === workspaceId) {
              boot.settings.activeWorkspace.name = name;
            }
            const catalogItem = boot.settings.workspaceCatalog.find(
              (item: { id: string }) => item.id === workspaceId,
            );
            if (catalogItem) catalogItem.name = name;
          }
          return boot.settings as never;
        }
        case "github_start_device_flow": {
          const expiresAt = Date.now() + 15 * 60 * 1000;
          return {
            userCode: "NANA-DEMO",
            verificationUri: "https://github.com/login/device",
            deviceCode: "mock-device-code",
            intervalSeconds: 5,
            expiresAt,
          } as never;
        }
        case "github_unbind": {
          boot.settings.githubBinding = null;
          ready = Boolean(boot.settings.workspaceRoot);
          return undefined as never;
        }
        case "github_poll_device_flow": {
          const binding = {
            login: "nana-demo",
            userId: 1,
            avatarUrl: "",
            name: "Nana Demo",
            clientIdSource: "mock",
            scopes: ["repo"],
            boundAt: Date.now(),
          };
          boot.settings.githubBinding = binding;
          return {
            status: "authorized",
            intervalSeconds: 5,
            bindingStatus: {
              state: "bound",
              clientIdConfigured: true,
              clientIdSource: "mock",
              binding,
            },
          } as never;
        }
        case "workspace_open_url":
        case "system_open_url":
        case "open_url":
          return undefined as never;
        case "system_copy_text":
        case "clipboard_write_text":
          return undefined as never;
        case "workspace_refresh_repos":
        case "workspace_list_managed_repos":
        case "workspace_scan_repos":
        case "workspace_discover_repos":
        case "workspace_list_local_repos":
          return (ready ? demoRepos() : []) as never;
        case "workspace_list_tasks":
          return [] as never;
        case "github_list_repo_owners":
          return ready
            ? [
                {
                  login: "nana-demo",
                  kind: "user",
                  avatarUrl: null,
                  membershipVisible: true,
                  membershipComplete: true,
                  membershipRestriction: null,
                  membershipRecoveryUrl: null,
                  repositoryAccessVisible: true,
                  source: "authenticated_user",
                },
              ]
            : ([] as never);
        case "github_list_repos": {
          const items = [
            {
              id: 101,
              name: "NanaUI",
              fullName: "nana-demo/NanaUI",
              ownerLogin: "nana-demo",
              private: false,
              archived: false,
              disabled: false,
              description: null,
              defaultBranch: "main",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              cloneUrl: "https://github.com/nana-demo/NanaUI.git",
              htmlUrl: "https://github.com/nana-demo/NanaUI",
              language: "Rust",
              owner: { login: "nana-demo", kind: "user" as const, avatarUrl: null },
              permissions: { admin: true, push: true, pull: true },
            },
            {
              id: 102,
              name: "LiliaGithub",
              fullName: "nana-demo/LiliaGithub",
              ownerLogin: "nana-demo",
              private: false,
              archived: false,
              disabled: false,
              description: null,
              defaultBranch: "main",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              cloneUrl: "https://github.com/nana-demo/LiliaGithub.git",
              htmlUrl: "https://github.com/nana-demo/LiliaGithub",
              language: "TypeScript",
              owner: { login: "nana-demo", kind: "user" as const, avatarUrl: null },
              permissions: { admin: true, push: true, pull: true },
            },
          ];
          return {
            items: ready ? items : [],
            nextPage: null,
            scope: { kind: "all" as const },
          } as never;
        }
        case "github_list_home_attention":
          return {
            pendingPullRequests: {
              items: [],
              failures: [],
              truncated: false,
              requestedRepositoryCount: 0,
              successfulRepositoryCount: 0,
            },
            workflowRuns: {
              items: [],
              failures: [],
              truncated: false,
              requestedRepositoryCount: 0,
              successfulRepositoryCount: 0,
            },
          } as never;
        case "github_list_repo_contribution": {
          const days = ready ? demoContributionDays() : [];
          const total = days.reduce((sum, day) => sum + day.count, 0);
          return {
            days,
            meta: {
              repoCount: ready ? 2 : 0,
              requestedRepoCount: ready ? 2 : 0,
              repoLimit: 30,
              truncated: false,
              skippedRepoCount: 0,
              refreshedAt: Date.now(),
              total,
            },
          } as never;
        }
        case "github_list_account_issues":
          return [] as never;
        case "github_list_pull_requests":
          return [] as never;
        case "github_list_action_notifications":
          return [] as never;
        case "github_list_watched_repos":
          return { items: [], nextPage: null } as never;
        case "workspace_get_repos":
          return (ready ? demoRepos() : []) as never;
        default:
          return { ok: true, command, mocked: true } as never;
      }
    },
  };
}
