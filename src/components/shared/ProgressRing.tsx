import { memo } from "react";

export const ProgressRing = memo(function ProgressRing({
  value,
  tone,
  large = false,
}: {
  value: number;
  tone: number;
  large?: boolean;
}) {
  const normalizedValue = Math.min(100, Math.max(0, value));
  const offset = 251.2 - (251.2 * normalizedValue) / 100;
  return (
    <div className={`progress-ring progress-ring--${tone} ${large ? "progress-ring--large" : ""}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="40" />
        <circle cx="50" cy="50" r="40" strokeDasharray="251.2" strokeDashoffset={offset} />
      </svg>
      <strong>{normalizedValue}%</strong>
    </div>
  );
});

