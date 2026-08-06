import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/ui/toast";
import "./styles/index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
  });
}

if ("serviceWorker" in navigator && import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}

import React from "react";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("应用界面发生异常", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: "100dvh", display: "grid", placeContent: "center", gap: "1rem", padding: "2rem", textAlign: "center", background: "var(--color-canvas, #f4f7fa)" }}>
          <h1>页面暂时无法显示</h1>
          <p>请刷新页面重试；你的学习数据仍保存在当前账号中。</p>
          {import.meta.env.DEV ? <code>{this.state.error?.toString()}</code> : null}
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
