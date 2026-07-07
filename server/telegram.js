// Verify Telegram Mini App initData so we can trust the user's identity.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import crypto from 'node:crypto'

/**
 * Returns the verified Telegram user object if the signature checks out, else null.
 * `botToken` must be the token of the bot that opened the mini app.
 */
export function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    if (computed !== hash) return null
    const userJson = params.get('user')
    return userJson ? JSON.parse(userJson) : null
  } catch {
    return null
  }
}
