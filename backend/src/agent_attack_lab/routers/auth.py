"""Browser session auth: login page, session probe, login, logout.

Password checks, cookie issuance and origin validation delegate to
``security``; this module only owns the HTTP shape.
"""

from __future__ import annotations

import hmac
from html import escape as escape_html
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse

from agent_attack_lab import config, security
from agent_attack_lab.models import BrowserLoginRequest

router = APIRouter()


@router.get("/login", response_class=HTMLResponse, include_in_schema=False)
def browser_login_page(
    request: Request,
    next: str = Query(default="/dashboard", max_length=2048),
) -> Response:
    destination = next or "/dashboard"
    if (
        not destination.startswith("/")
        or destination.startswith(("//", "/login"))
        or "\\" in destination
        or any(ord(char) < 32 for char in destination)
    ):
        destination = "/dashboard"
    if config.browser_password and security.has_browser_session(request):
        return RedirectResponse(
            destination, status_code=303, headers={"Cache-Control": "no-store"}
        )
    login_enabled = bool(config.browser_password)
    disabled_message = (
        "浏览器密码登录尚未启用，请联系服务管理员配置。"
        if not login_enabled
        else "使用后台管理密码建立安全浏览器会话。"
    )
    page = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>后台登录 · 智能体攻防实验室</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; color: #17202a; background: #f2f5f7; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: linear-gradient(135deg, #eaf3fb, #f7f8f8 55%, #e8f4ee); }
    main { width: min(100%, 420px); }
    .brand { margin: 0 0 20px; color: #52616d; font-size: 13px; letter-spacing: .08em; }
    .brand strong { display: block; margin-top: 7px; color: #17202a; font-size: 25px; letter-spacing: 0; }
    form { padding: 28px; border: 1px solid #d6e0e5; border-radius: 8px; background: #fff; box-shadow: 0 16px 40px #1e354510; }
    h1 { margin: 0 0 7px; font-size: 21px; }
    .hint { margin: 0 0 23px; color: #667580; font-size: 13px; line-height: 1.6; }
    label { display: block; margin-bottom: 8px; color: #35434e; font-size: 13px; font-weight: 600; }
    input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #bfcbd2; border-radius: 5px; font: inherit; }
    input:focus { border-color: #1673b8; outline: 3px solid #1673b822; }
    button { width: 100%; min-height: 44px; margin-top: 18px; border: 0; border-radius: 5px; background: #176fae; color: white; font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { background: #105e96; }
    button:disabled { cursor: wait; opacity: .65; }
    [role=alert] { min-height: 20px; margin-top: 12px; color: #b42318; font-size: 13px; }
    .disabled { padding: 12px; border: 1px solid #e5c981; border-radius: 5px; background: #fff9e8; color: #705314; font-size: 13px; line-height: 1.6; }
    @media (max-width: 480px) { body { padding: 18px; } form { padding: 23px 19px; } }
  </style>
</head>
<body>
  <main>
    <p class="brand">AGENT ATTACK LAB<strong>后台管理登录</strong></p>
    <form id="login-form" data-next="__NEXT__" autocomplete="on">
      <h1>登录管理后台</h1>
      <p class="hint">__MESSAGE__</p>
      __FORM_CONTENT__
      <div id="error" role="alert" aria-live="polite"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById("login-form");
    const passwordInput = document.getElementById("password");
    if (form && passwordInput) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        const error = document.getElementById("error");
        button.disabled = true;
        error.textContent = "";
        try {
          const response = await fetch("/auth/session", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: passwordInput.value }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.detail || "登录失败，请重试");
          window.location.replace(form.dataset.next || "/dashboard");
        } catch (failure) {
          error.textContent = failure instanceof Error ? failure.message : "登录失败，请重试";
          button.disabled = false;
          passwordInput.focus();
        }
      });
    }
  </script>
</body>
</html>"""
    form_content = (
        '<label for="password">后台管理密码</label><input id="password" name="password" type="password" '
        'autocomplete="current-password" required maxlength="256" autofocus><button type="submit">登录</button>'
        if login_enabled
        else f'<div class="disabled">{escape_html(disabled_message)}</div>'
    )
    page = page.replace("__NEXT__", escape_html(destination, quote=True))
    page = page.replace("__MESSAGE__", escape_html(disabled_message))
    page = page.replace("__FORM_CONTENT__", form_content)
    return HTMLResponse(
        page, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    )


@router.get("/auth/session", summary="查询浏览器登录状态", tags=["浏览器鉴权"])
def browser_session_status(request: Request, response: Response) -> dict[str, bool]:
    response.headers["Cache-Control"] = "no-store"
    authenticated = bool(config.browser_password) and security.has_browser_session(
        request
    )
    if security.verify_cloudflare_access_jwt(
        request.headers.get("cf-access-jwt-assertion", "")
    ):
        authenticated = True
    return {
        "enabled": bool(config.browser_password) or config.cloudflare_access_configured,
        "authenticated": authenticated,
    }


@router.post(
    "/auth/session",
    dependencies=[Depends(security.login_rate_limit)],
    summary="创建浏览器登录会话",
    tags=["浏览器鉴权"],
)
def create_browser_session(
    payload: BrowserLoginRequest,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    if not config.browser_password:
        raise HTTPException(status_code=503, detail="浏览器登录尚未启用")
    origin = request.headers.get("origin", "")
    if origin and not security.browser_origin_allowed(origin, request):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")
    if not hmac.compare_digest(
        payload.password.encode("utf-8"), config.browser_password.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="登录密码错误")
    token = security.issue_browser_session()
    response.set_cookie(
        key=config.browser_cookie_name,
        value=token,
        max_age=config.browser_session_ttl_seconds,
        httponly=True,
        secure=config.browser_cookie_secure,
        samesite=config.browser_cookie_samesite,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "authenticated": True,
        "expiresInSeconds": config.browser_session_ttl_seconds,
    }


@router.delete("/auth/session", summary="退出浏览器登录", tags=["浏览器鉴权"])
def delete_browser_session(request: Request, response: Response) -> dict[str, bool]:
    origin = request.headers.get("origin", "")
    if origin and not security.browser_origin_allowed(origin, request):
        raise HTTPException(status_code=403, detail="浏览器来源未获允许")
    security.revoke_browser_session(request)
    response.delete_cookie(
        key=config.browser_cookie_name,
        httponly=True,
        secure=config.browser_cookie_secure,
        samesite=config.browser_cookie_samesite,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": False}
