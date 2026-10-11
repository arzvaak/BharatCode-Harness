/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference and content font size.
 * Head CSS colors the document canvas before script execution; the body script
 * installs the palette selector and font size that the client presenters adopt.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, type ThemePreference } from './theme-settings.ts'

const LIGHT_BACKGROUND = '#fff'
const DARK_BACKGROUND = '#151517'

/** CSS that colors the document canvas before any script executes. */
function bootThemeStyle(preference: ThemePreference): string {
  const light = `:root{color-scheme:light}body{background-color:${LIGHT_BACKGROUND};--dsh-boot-bg:${LIGHT_BACKGROUND}}`
  const dark = `:root{color-scheme:dark}body{background-color:${DARK_BACKGROUND};--dsh-boot-bg:${DARK_BACKGROUND}}`
  if (preference === 'light') return light
  if (preference === 'dark') return dark
  return `${light}@media(prefers-color-scheme:dark){${dark}}`
}

/** Build the body script that installs the palette selector and content size. */
function bootThemeBodyScript(preference: ThemePreference, fontSize: number, allowLegacy: boolean): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  let selected = preference
  if (${JSON.stringify(allowLegacy)}) {
    try {
      const legacy = localStorage.getItem('dsh.theme')
      if (legacy === 'light' || legacy === 'dark' || legacy === 'system') selected = legacy
    } catch {}
  }
  const systemDark = selected === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = selected === 'dark' || systemDark
  document.documentElement.dataset.dsThemeSource = selected
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.style.setProperty('--dsh-boot-bg', dark ? ${JSON.stringify(DARK_BACKGROUND)} : ${JSON.stringify(LIGHT_BACKGROUND)})
  document.body.style.backgroundColor = 'var(--dsw-alias-bg-base, var(--dsh-boot-bg))'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', ${JSON.stringify(`${fontSize}px`)})
})()`
}

/**
 * Theme bootstrap rows: head CSS colors the document canvas before
 * first paint, then the body script installs the palette selector and font
 * size before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @param fontSize - Current Host-backed content font size in px.
 * @param allowLegacy - Whether no explicit Host preference supersedes browser storage.
 * @returns head and body script rows in execution order.
 */
export function bootThemeInjections(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
  allowLegacy = false,
): IndexInjection[] {
  return [
    { kind: 'style', text: bootThemeStyle(preference) },
    { kind: 'script', placement: 'body', text: bootThemeBodyScript(preference, fontSize, allowLegacy) },
  ]
}
