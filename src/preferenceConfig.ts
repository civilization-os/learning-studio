import type { OutlinePreferences } from "./studyAgent";

export type PreferenceKey = keyof OutlinePreferences;

export type PreferenceQuestionConfig = {
  key: PreferenceKey;
  title: string;
  description: string;
  options: readonly string[];
  skipLabel: string;
  customPlaceholder: string;
  wide?: boolean;
};

export const preferenceQuestions: readonly PreferenceQuestionConfig[] = [
  {
    key: "learningGoal",
    title: "这次学习主要为了什么？",
    description: "决定课程更偏理解、应用还是备考。",
    options: ["快速入门", "解决实际问题", "考试或认证", "系统掌握"],
    skipLabel: "由课题判断",
    customPlaceholder: "例如：三个月后独立完成一个 Flink 实时项目",
  },
  {
    key: "currentLevel",
    title: "你现在大概是什么基础？",
    description: "决定从哪里开始，以及哪些内容可以略过。",
    options: ["从零开始", "了解一些概念", "做过基础练习", "已有实践经验"],
    skipLabel: "不确定",
    customPlaceholder: "例如：会 Java 和 SQL，但没有流处理经验",
  },
  {
    key: "coveragePreference",
    title: "你希望课程覆盖到什么程度？",
    description: "它决定内容取舍；“尽量全面”仍会遵守课程规模和课堂时长上限。",
    options: ["核心必学", "标准覆盖", "完整体系", "尽量全面"],
    skipLabel: "由内容决定",
    customPlaceholder: "例如：完整覆盖考试范围，但弱化证明推导",
    wide: true,
  },
  {
    key: "timeBudget",
    title: "准备投入多少时间？",
    description: "它是课程规模的现实约束，不等同于内容覆盖程度。",
    options: ["10 小时以内", "20–40 小时", "60–100 小时", "100 小时以上"],
    skipLabel: "按内容需要安排",
    customPlaceholder: "例如：8 周，每周 6 小时",
  },
  {
    key: "sessionLength",
    title: "一次学习多长时间比较合适？",
    description: "用于控制每个课堂小节的大小。",
    options: ["每次 30 分钟", "每次 45 分钟", "每次 60 分钟", "每次 90 分钟"],
    skipLabel: "灵活安排",
    customPlaceholder: "例如：工作日 30 分钟，周末 2 小时",
  },
];
