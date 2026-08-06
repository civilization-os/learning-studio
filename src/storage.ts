import { defaultState, StudyState } from "./studyAgent";

const STORAGE_KEY_PREFIX = "learning-studio-state-v6";

function freshDefaultState(): StudyState {
  return structuredClone(defaultState);
}

function getStorageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function loadStudyState(userId?: string | null): StudyState {
  if (!userId) return freshDefaultState();
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return freshDefaultState();

    const saved = JSON.parse(raw) as Partial<StudyState>;
    return {
      ...freshDefaultState(),
      ...saved,
      modelSettings: {
        ...defaultState.modelSettings,
        ...saved.modelSettings,
        apiKey: "",
        webSearchApiKey: "",
      },
      projects: Array.isArray(saved.projects)
        ? saved.projects
        : freshDefaultState().projects,
    };
  } catch {
    return freshDefaultState();
  }
}

export function saveStudyState(userId: string | null | undefined, state: StudyState) {
  if (!userId) return;
  const safeState: StudyState = {
    ...state,
    modelSettings: {
      ...state.modelSettings,
      apiKey: "",
      webSearchApiKey: "",
    },
  };
  localStorage.setItem(getStorageKey(userId), JSON.stringify(safeState));
}
