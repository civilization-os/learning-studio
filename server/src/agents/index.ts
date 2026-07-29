import { AgentName, AgentRunResult, AppStore } from "../types.js";
import { courseContentAgent } from "./courseContentAgent.js";
import { chapterToolLibraryAgent } from "./chapterToolLibraryAgent.js";
import { exerciseAgent } from "./exerciseAgent.js";
import { learningPlannerAgent } from "./learningPlannerAgent.js";
import { outlineAgent } from "./outlineAgent.js";
import { projectCreatorAgent } from "./projectCreatorAgent.js";
import { tutorAgent } from "./tutorAgent.js";
import { AgentDefinition } from "./types.js";
import type { GenerationProgress } from "../generationTasks.js";

const agents: Record<AgentName, AgentDefinition> = {
  "project-creator": projectCreatorAgent,
  outline: outlineAgent,
  "course-content": courseContentAgent,
  "chapter-tool-library": chapterToolLibraryAgent,
  exercise: exerciseAgent,
  tutor: tutorAgent,
  "learning-planner": learningPlannerAgent,
};

export function listAgents() {
  return Object.values(agents).map((agent) => ({
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
  }));
}

export async function runAgent(params: {
  agentName: AgentName;
  input: Record<string, unknown>;
  projectId?: string;
  store: AppStore;
  reportProgress?: (progress: GenerationProgress) => void;
}): Promise<AgentRunResult> {
  const agent = agents[params.agentName];
  if (!agent) throw new Error(`未知 Agent：${params.agentName}`);

  const project = params.projectId
    ? params.store.projects.find((item) => item.id === params.projectId)
    : undefined;

  return agent.run(params.input, {
    store: params.store,
    project,
    reportProgress: params.reportProgress,
  });
}
