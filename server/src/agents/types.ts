import { AgentName, AgentRunResult, AppStore, LearningProject } from "../types.js";

export type AgentContext = {
  store: AppStore;
  project?: LearningProject;
};

export type AgentDefinition = {
  name: AgentName;
  displayName: string;
  description: string;
  run(input: Record<string, unknown>, context: AgentContext): Promise<AgentRunResult>;
};
