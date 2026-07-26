import { defaultState, StudyState } from "./studyAgent";

const STORAGE_KEY = "learning-studio-state-v5";

function freshDefaultState(): StudyState {
  return structuredClone(defaultState);
}

export function loadStudyState(): StudyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
      projects: saved.projects?.length ? saved.projects : freshDefaultState().projects,
    };
  } catch {
    return freshDefaultState();
  }
}

export function saveStudyState(state: StudyState) {
  const safeState: StudyState = {
    ...state,
    modelSettings: {
      ...state.modelSettings,
      apiKey: "",
      webSearchApiKey: "",
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
}
