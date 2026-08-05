import type { WorkspaceCommandName } from "./contracts";
import {
  WORKSPACE_COMMAND_MANIFEST,
  type GeneratedWorkspaceCommandName,
  type WorkspaceCommandDomain,
} from "./generatedCommands";

export {
  WORKSPACE_COMMAND_MANIFEST,
  type GeneratedWorkspaceCommandName,
  type WorkspaceCommandDomain,
};

export type WorkspaceCommandManifestEntry<
  TCommand extends WorkspaceCommandName = WorkspaceCommandName,
> = {
  command: TCommand;
  domain: WorkspaceCommandDomain;
};

type AssertNever<T extends never> = T;

export type WorkspaceCommandManifestCoverage = [
  AssertNever<Exclude<WorkspaceCommandName, GeneratedWorkspaceCommandName>>,
  AssertNever<Exclude<GeneratedWorkspaceCommandName, WorkspaceCommandName>>,
];
