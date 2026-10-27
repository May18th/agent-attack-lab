export const loginDialogStyles = `
    .agent-login-mask{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(2,5,12,.78);backdrop-filter:blur(8px)}
    .agent-login-mask.open{display:flex}
    .agent-login-box{width:min(420px,100%);border:1px solid #35475d;border-radius:10px;background:#101722;padding:22px 24px;box-shadow:0 20px 70px rgba(0,0,0,.62)}
    .agent-login-box h2{font-size:18px;margin:0 0 5px}
    .agent-login-box p{color:#8fa0b2;font-size:12px;margin:0 0 15px;line-height:1.65}
    .agent-login-field{display:grid;gap:7px;margin:18px 0 10px}
    .agent-login-field label{color:#c7d8e7;font-size:12px;line-height:1.4}
    .agent-login-password{width:100%;min-height:44px;box-sizing:border-box;padding:11px 13px;border:1px solid rgba(123,163,191,.5);border-radius:8px;background:rgba(4,12,25,.84);color:#f4fbff;font:14px "Cascadia Code",Consolas,monospace;outline:0;transition:border-color .18s ease,box-shadow .18s ease,background-color .18s ease}
    .agent-login-password::placeholder{color:#70879c}
    .agent-login-password:hover{border-color:rgba(103,232,249,.62)}
    .agent-login-password:focus-visible{border-color:#67e8f9;background:rgba(6,20,37,.94);box-shadow:0 0 0 3px rgba(34,211,238,.13),0 0 20px rgba(34,211,238,.1)}
    .agent-login-password:disabled{opacity:.62}
    .agent-login-actions{display:flex;justify-content:flex-end;gap:8px}
    .agent-login-error{min-height:18px;color:#ff8f6b;font-size:12px;margin-bottom:8px}
    .agent-session-logout{display:none;border:1px solid #35475d;border-radius:6px;background:#101722;color:#9fb0c2;padding:7px 11px;font-size:12px;cursor:pointer}.agent-session-logout:hover{border-color:#59738f;color:#fff}
    @media(max-width:480px){.agent-login-mask{padding:16px}.agent-login-box{padding:20px}.agent-login-actions .btn-ready{width:100%!important}}
    @media(prefers-reduced-motion:reduce){.agent-login-password{transition:none}}
  `

export const loginDialogMarkup = '<h2>登录攻防实验室</h2><p id="agentLoginHint">密码只发送给后端换取 HttpOnly 会话，不会存入网页或浏览器存储。</p><div class="agent-login-field"><label for="agentLoginPassword">登录密码</label><input class="agent-login-password" id="agentLoginPassword" type="password" autocomplete="current-password" placeholder="输入浏览器访问密码" aria-describedby="agentLoginHint" required maxlength="256"></div><div class="agent-login-error" id="agentLoginError" role="alert" aria-live="polite"></div>'
