import { defaultState, StudyState } from "./studyAgent";

const STORAGE_KEY_PREFIX = "learning-studio-state-v6";
// 旧版(多用户改造前)的单 key,未登录/匿名场景回退读取以继承旧学习状态
const LEGACY_STORAGE_KEY = "learning-studio-state-v5";

function freshDefaultState(): StudyState {
  return structuredClone(defaultState);
}

function getStorageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function parseSavedState(raw: string): StudyState {
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
}

export function loadStudyState(userId?: string | null): StudyState {
  if (!userId) {
    // 未登录:兼容旧版单 key,回退读取 v5 数据(只读不写,待登录后归入用户 key)
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) return parseSavedState(raw);
    } catch {
      // ignore malformed legacy data
    }
    return freshDefaultState();
  }
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (raw) return parseSavedState(raw);

    // 用户首次登录且无自己的数据:把旧版 v5 数据迁移到该用户的 key
    // (单用户时代的旧数据归首个登录的用户,迁移完成后移除 v5,避免被多用户重复继承)
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const state = parseSavedState(legacyRaw);
      localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return state;
    }
    return freshDefaultState();
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
