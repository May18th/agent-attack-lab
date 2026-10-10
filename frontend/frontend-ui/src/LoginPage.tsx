import type { FormEvent } from 'react'
import './LoginPage.css'

type ServiceStatus = 'loading' | 'ok' | 'error'

type LoginPageProps = {
  status: ServiceStatus
  onRetryHealth: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  password: string
  onPasswordChange: (value: string) => void
  busy: boolean
  error: string
}

export default function LoginPage({
  status,
  onRetryHealth,
  onSubmit,
  password,
  onPasswordChange,
  busy,
  error,
}: LoginPageProps) {
  const statusLabel = status === 'loading'
    ? '正在检查服务（Checking service）'
    : status === 'ok'
      ? '服务运行正常（Service healthy）'
      : '服务连接失败（Connection failed）· 点击重试（Retry）'

  return <main className="login-page">
    <div className="login-grid" aria-hidden="true" />
    <section className="login-shell" aria-labelledby="login-title">
      <div className="login-intro">
        <div className="login-mark">AAL</div>
        <div className="eyebrow">AGENT ATTACK LAB</div>
        <h1>智能体<em>攻防实验室</em></h1>
        <p>安全访问控制台</p>
        <div className="login-divider" />
        <div className="login-meta">
          <span className="login-meta-dot" />
          <span>浏览器会话鉴权已启用（Browser session enabled）</span>
        </div>
      </div>

      <div className="login-card glass">
        <div className="en">SECURE ACCESS</div>
        <h2 id="login-title">登录控制台（Sign in）</h2>
        <p className="login-subtitle">输入访问密码以继续。</p>
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <label htmlFor="browser-password">浏览器密码（Browser password）
            <input
              id="browser-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </label>
          {error && <div className="field-error" id="login-error" role="alert">{error}</div>}
          <button className="btn-primary login-submit" type="submit" disabled={busy || !password}>
            {busy ? '登录中（Signing in）...' : '登录（Sign in）'}
          </button>
        </form>
        <button
          className={'login-health status ' + status}
          type="button"
          onClick={() => status === 'error' && onRetryHealth()}
          disabled={status === 'loading'}
        >
          <span className="dot" />{statusLabel}
        </button>
      </div>
    </section>
  </main>
}
