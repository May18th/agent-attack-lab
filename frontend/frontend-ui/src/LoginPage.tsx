import './LoginPage.css'

type ServiceStatus = 'loading' | 'ok' | 'error'

type LoginPageProps = {
  status: ServiceStatus
  onRetryHealth: () => void
  onRetryAuth: () => void
  error: string
}

export default function LoginPage({
  status,
  onRetryHealth,
  onRetryAuth,
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
        <h2 id="login-title">等待组织认证（Awaiting sign-in）</h2>
        <p className="login-subtitle">请先在当前浏览器完成 Cloudflare Access 组织认证，认证由后台策略处理，页面不收集密码。</p>
        {error && <div className="field-error" id="login-error" role="alert">{error}</div>}
        <button className="btn-primary login-submit" type="button" onClick={onRetryAuth}>
          我已完成认证，重新检查（Check access）
        </button>
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
