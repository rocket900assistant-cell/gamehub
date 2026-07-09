/** Light / dark theme: toggles a `.dark` class on <html> and syncs Telegram chrome. */
export type Theme = 'light' | 'dark'

const KEY = 'gh_theme'

const BG = { light: '#f8f5f0', dark: '#131519' }

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Apply the stored theme: sets the `.dark` class + Telegram bg/header colors. */
export function applyTheme() {
  const t = getTheme()
  document.documentElement.classList.toggle('dark', t === 'dark')
  const wa = (window as unknown as { Telegram?: { WebApp?: { setBackgroundColor?: (c: string) => void; setHeaderColor?: (c: string) => void } } })
    .Telegram?.WebApp
  try {
    wa?.setBackgroundColor?.(BG[t])
    wa?.setHeaderColor?.(BG[t])
  } catch {
    // older Telegram clients — ignore
  }
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // ignore
  }
  applyTheme()
}
