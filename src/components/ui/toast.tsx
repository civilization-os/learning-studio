import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { createId } from "../../lib/id";

export type ToastVariant = "success" | "error" | "warning" | "info";

type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
};

type ToastContextValue = {
  notify: (toast: Omit<Toast, "id">) => void;
};

const toastMeta: Record<ToastVariant, { icon: string; label: string }> = {
  success: { icon: "✓", label: "正常" },
  error: { icon: "×", label: "错误" },
  warning: { icon: "!", label: "告警" },
  info: { icon: "i", label: "提示" },
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((toast: Omit<Toast, "id">) => {
    const id = createId();
    const variant = toast.variant ?? "info";
    setToasts((current) => [{ ...toast, variant, id }, ...current].slice(0, 4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, variant === "error" ? 6_000 : 4_200);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" aria-live="polite" aria-label="消息通知">
        {toasts.map((toast) => {
          const variant = toast.variant ?? "info";
          const meta = toastMeta[variant];
          return (
            <div
              className={`ui-toast ui-toast--${variant}`}
              key={toast.id}
              role={variant === "error" ? "alert" : "status"}
            >
              <span className="ui-toast__icon" aria-hidden="true">{meta.icon}</span>
              <div className="ui-toast__copy">
                <small>{meta.label}</small>
                <strong>{toast.title}</strong>
                {toast.description ? <span>{toast.description}</span> : null}
              </div>
              <button
                className="ui-toast__close"
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={`关闭${meta.label}消息`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);

  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return value;
}
