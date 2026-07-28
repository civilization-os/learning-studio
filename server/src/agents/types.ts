import { AgentName, AgentRunResult, AppStore, LearningProject } from "../types.js";
import type { GenerationProgress } from "../generationTasks.js";

export type AgentContext = {
  store: AppStore;
  project?: LearningProject;
  reportProgress?: (progress: GenerationProgress) => void;
};

export type AgentDefinition = {
  name: AgentName;
  displayName: string;
  description: string;
  run(input: Record<string, unknown>, context: AgentContext): Promise<AgentRunResult>;
};
