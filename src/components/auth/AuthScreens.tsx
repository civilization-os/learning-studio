import React, { useState, useEffect } from "react";
import {
  loginRemote,
  registerRemote,
  sendVerificationCode,
  type AuthResult,
} from "../../api";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card";
import { Input, Label } from "../ui/field";

export function AuthScreens({ onAuthenticated }: { onAuthenticated: (session: AuthResult) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [avatar, setAvatar] = useState("🐶");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const defaultAvatars = ["🐶", "🐱", "🦊", "🐼", "🐰", "🦁", "🦉", "🦄"];

  useEffect(() => {
    let timer: number;
    if (countdown > 0) {
      timer = window.setInterval(() => setCountdown(c => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    if (!email || !email.includes("@")) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setError("");
    setNotice("");
    setSendingCode(true);
    try {
      const result = await sendVerificationCode(email);
      if (result.devCode) {
        setCode(result.devCode);
        setNotice(`本地开发验证码已自动填入：${result.devCode}`);
      } else {
        setNotice(result.message);
      }
      setCountdown(60);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "验证码发送失败");
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = isLogin
        ? await loginRemote(username, password)
        : await registerRemote(username, password, email, code, avatar, nickname.trim());
      onAuthenticated(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="产品介绍">
        <span className="auth-kicker">你的个人学习编辑部</span>
        <h1>把零散资料，整理成一条真正学得会的路径。</h1>
        <p>从课程大纲、每日计划到课堂练习与复习证据，所有进度都在同一张学习地图里。</p>
        <div className="auth-story-metrics" aria-label="产品能力">
          <span><strong>01</strong>规划学习路径</span>
          <span><strong>02</strong>生成互动课堂</span>
          <span><strong>03</strong>追踪掌握证据</span>
        </div>
      </section>
      <Card className="auth-card">
        <CardHeader>
          <div className="auth-brand">
            <img src="/icons/icon-192.svg" alt="" width="48" height="48" />
            <CardTitle>{isLogin ? "登录工作台" : "注册新账号"}</CardTitle>
            <CardDescription>
              {isLogin ? "欢迎回来，继续您的学习之旅" : "加入我们，开启个性化学习体验"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="auth-form" name={isLogin ? "loginForm" : "registerForm"} onSubmit={handleSubmit}>
            <div className="auth-field">
              <Label htmlFor="username">用户名</Label>
              <Input 
                id="username"
                name="username"
                type="text" 
                autoComplete="username"
                spellCheck={false}
                minLength={3}
                maxLength={32}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="例如：lin_study…"
                required 
              />
            </div>
            {!isLogin && (
              <div className="auth-field">
                <Label htmlFor="nickname">个性昵称<small style={{ color: "var(--color-text-muted)", marginLeft: "4px" }}>（选填）</small></Label>
                <Input 
                  id="nickname"
                  name="nickname"
                  type="text" 
                  autoComplete="nickname"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="例如：小林…"
                />
              </div>
            )}
            {!isLogin && (
              <>
                <div className="auth-field">
                  <Label htmlFor="email">邮箱地址</Label>
                  <Input 
                    id="email"
                  name="email"
                  type="email" 
                  autoComplete="email"
                  spellCheck={false}
                  maxLength={254}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="例如：name@example.com…"
                    required={!isLogin} 
                  />
                </div>
                <div className="auth-field">
                  <Label htmlFor="code">验证码</Label>
                  <div className="auth-code-row">
                    <Input 
                      id="code"
                      name="code"
                      type="text" 
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      spellCheck={false}
                      value={code}
                      onChange={e => setCode(e.target.value)}
                      placeholder="6 位数字…"
                      required={!isLogin} 
                      style={{ flex: 1 }}
                    />
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={handleSendCode} 
                      disabled={sendingCode || countdown > 0}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {sendingCode ? "正在发送…" : countdown > 0 ? `${countdown}s 后重发` : "发送验证码"}
                    </Button>
                  </div>
                </div>
              </>
            )}
            <div className="auth-field">
              <Label htmlFor="password">密码</Label>
              <Input 
                id="password"
                name="password"
                type="password" 
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={isLogin ? undefined : 8}
                maxLength={128}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="输入密码…"
                required 
              />
            </div>
            {!isLogin && (
              <div className="auth-field">
                <Label>选择头像</Label>
                <div className="auth-avatar-grid">
                  {defaultAvatars.map(a => (
                    <button
                      key={a}
                      type="button"
                      aria-label={`选择头像 ${a}`}
                      aria-pressed={avatar === a}
                      onClick={() => setAvatar(a)}
                      style={{
                        fontSize: "1.5rem",
                        padding: "0.25rem",
                        borderRadius: "8px",
                        border: avatar === a ? "2px solid var(--color-accent)" : "2px solid transparent",
                        backgroundColor: avatar === a ? "var(--color-surface-muted)" : "transparent",
                        cursor: "pointer",
                        transition: "border-color 0.2s, background-color 0.2s"
                      }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {notice && <div role="status" aria-live="polite" style={{ color: "var(--color-success, #047857)", fontSize: "0.875rem" }}>{notice}</div>}
            {error && <div role="alert" style={{ color: "var(--color-danger)", fontSize: "0.875rem", padding: "0.75rem", backgroundColor: "var(--color-danger-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-danger)" }}>{error}</div>}
            
            <Button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "正在处理…" : (isLogin ? "进入学习工作台" : "创建学习账号")}
            </Button>
            
            <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
              <Button 
                type="button" 
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError("");
                  setNotice("");
                }}
              >
                {isLogin ? "没有账号？点击注册" : "已有账号？点击登录"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
