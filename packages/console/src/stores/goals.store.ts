import { create } from "zustand";
import type { Goal } from "../api/types";

interface GoalsState {
  goals: Goal[];
  selectedGoalId: string | null;
  setGoals: (goals: Goal[]) => void;
  selectGoal: (goalId: string | null) => void;
  buildTree: (goals: Goal[]) => Map<string | undefined, Goal[]>;
}

export const useGoalsStore = create<GoalsState>((set) => ({
  goals: [],
  selectedGoalId: null,

  setGoals: (goals) => set({ goals }),

  selectGoal: (goalId) => set({ selectedGoalId: goalId }),

  buildTree: (goals) => {
    const tree = new Map<string | undefined, Goal[]>();
    for (const goal of goals) {
      const children = tree.get(goal.parent_goal_id) ?? [];
      children.push(goal);
      tree.set(goal.parent_goal_id, children);
    }
    for (const [, children] of tree) {
      children.sort((a, b) => a.priority - b.priority);
    }
    return tree;
  },
}));
