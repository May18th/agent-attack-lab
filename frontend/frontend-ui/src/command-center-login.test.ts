import { describe, expect, it } from 'vitest'
import { loginDialogMarkup, loginDialogStyles } from './command-center-login'

describe('command center login dialog', () => {
  it('exposes a styled, labeled password field for the session prompt', () => {
    expect(loginDialogMarkup).toContain('class="agent-login-password"')
    expect(loginDialogMarkup).toContain('登录密码')
    expect(loginDialogMarkup).toContain('autocomplete="current-password"')
    expect(loginDialogStyles).toContain('.agent-login-password')
    expect(loginDialogStyles).toContain('@media(max-width:480px)')
  })
})
