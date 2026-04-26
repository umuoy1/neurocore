import type { AgentSessionHandle } from "@neurocore/sdk-core";
import {
  buildPersonalAgentTrajectoryBenchmarkArtifact,
  exportPersonalAgentTrajectory,
  replayPersonalAgentTrajectoryBenchmarkArtifact,
  type PersonalAgentTrajectoryBenchmarkArtifact,
  type PersonalAgentTrajectoryExport,
  type PersonalAgentTrajectoryExportOptions,
  type PersonalAgentTrajectoryReplayReport
} from "@neurocore/eval-core";

export interface ExportPersonalAssistantSessionTrajectoryOptions
  extends Omit<PersonalAgentTrajectoryExportOptions, "sessionReplay"> {}

export function exportPersonalAssistantSessionTrajectory(
  handle: AgentSessionHandle,
  options: ExportPersonalAssistantSessionTrajectoryOptions = {}
): PersonalAgentTrajectoryExport {
  return exportPersonalAgentTrajectory({
    ...options,
    sessionReplay: handle.replay()
  });
}

export function buildPersonalAssistantTrajectoryBenchmarkArtifact(
  trajectories: PersonalAgentTrajectoryExport[],
  options: { artifactId?: string; createdAt?: string; caseIds?: string[] } = {}
): PersonalAgentTrajectoryBenchmarkArtifact {
  return buildPersonalAgentTrajectoryBenchmarkArtifact(trajectories, options);
}

export function replayPersonalAssistantTrajectoryBenchmarkArtifact(
  artifact: PersonalAgentTrajectoryBenchmarkArtifact
): PersonalAgentTrajectoryReplayReport {
  return replayPersonalAgentTrajectoryBenchmarkArtifact(artifact);
}
