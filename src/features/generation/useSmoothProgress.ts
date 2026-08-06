import { useEffect, useState } from "react";
import type { GenerationTask } from "../../api";

function getTaskSmoothProgress(task?: GenerationTask): number {
  if (!task) return 0;
  if (task.status === "completed") return 100;
  if (task.status === "failed") return 0;

  const raw = task.progress ?? 0;
  const createdTime = new Date(task.createdAt || task.updatedAt || Date.now()).getTime();
  const elapsedSec = Math.max(0, (Date.now() - createdTime) / 1000);
  const timeBased = Math.min(94, Math.round(6 + elapsedSec * 2.2));
  return Math.min(99, Math.max(0, raw, timeBased));
}

export function useSmoothProgress(task?: GenerationTask) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!task || task.status === "completed" || task.status === "failed") return;
    const timer = window.setInterval(() => {
      setTick((tick) => tick + 1);
    }, 400);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);

  return getTaskSmoothProgress(task);
}

