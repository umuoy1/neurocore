import type { CoordinationContext, CoordinationResult, TaskAssignment } from "../types.js";

export interface CoordinationStrategy {
  name: string;
  coordinate(ctx: CoordinationContext): Promise<CoordinationResult>;
  resolveConflict?(
    ctx: CoordinationContext,
    conflictingAssignments: TaskAssignment[]
  ): Promise<TaskAssignment[]>;
}
