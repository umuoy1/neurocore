import type { AgentSessionHandle } from "@neurocore/sdk-core";
import {
  buildPersonalAgentTrajectoryBenchmarkArtifact,
  buildPersonalAgentTrajectoryPipelineArtifact,
  buildPersonalAgentTrajectoryTrainingArtifact,
  exportPersonalAgentTrajectory,
  replayPersonalAgentTrajectoryBenchmarkArtifact,
  validatePersonalAgentTrajectoryPipelineArtifact,
  type PersonalAgentTrajectoryBenchmarkArtifact,
  type PersonalAgentTrajectoryExport,
  type PersonalAgentTrajectoryExportOptions,
  type PersonalAgentTrajectoryPipelineArtifact,
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

export function buildPersonalAssistantTrajectoryTrainingArtifact(
  trajectories: PersonalAgentTrajectoryExport[],
  options: { artifactId?: string; createdAt?: string; maxCharsPerField?: number } = {}
) {
  return buildPersonalAgentTrajectoryTrainingArtifact(trajectories, options);
}

export function buildPersonalAssistantTrajectoryPipelineArtifact(
  trajectories: PersonalAgentTrajectoryExport[],
  options: {
    artifactId?: string;
    batchId?: string;
    createdAt?: string;
    benchmarkArtifactId?: string;
    trainingArtifactId?: string;
    maxCharsPerField?: number;
  } = {}
): PersonalAgentTrajectoryPipelineArtifact {
  return buildPersonalAgentTrajectoryPipelineArtifact(trajectories, options);
}

export function validatePersonalAssistantTrajectoryPipelineArtifact(
  artifact: PersonalAgentTrajectoryPipelineArtifact
) {
  return validatePersonalAgentTrajectoryPipelineArtifact(artifact);
}
