// Backend subcommand routing for the desktop-managed Hermes process.
//
// The desktop app launches its own headless backend via `hermes serve` — it
// must NEVER depend on or launch the browser `dashboard`. But `serve` is a
// newer subcommand: a runtime that predates it (an older managed install the
// app hasn't updated yet, or an older `hermes` resolved from PATH) only knows
// `dashboard --no-open`. To avoid bricking those users mid-upgrade we detect
// whether the resolved runtime understands `serve` and, only when it does not,
// fall back to the legacy `dashboard --no-open` invocation. Both produce the
// exact same headless gateway; `serve` is just the decoupled name.
//
// These helpers are pure so they can be unit-tested without Electron.

/** Mirrors hermes_cli.profiles._PROFILE_ID_RE. */
export const DESKTOP_PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function isDesktopProfileName(name: string): boolean {
  return name === 'default' || DESKTOP_PROFILE_NAME_RE.test(name)
}

/**
 * Parse Desktop's stored `active-profile.json` body. Missing / malformed /
 * null / empty / invalid names are "no stored preference" (null). Callers that
 * need a spawn identity must still run this through
 * `desktopBackendProfileIdentity` — null does not mean "omit --profile".
 */
export function parseStoredDesktopProfile(source: unknown): string | null {
  let parsed = source

  if (typeof source === 'string') {
    try {
      parsed = JSON.parse(source)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const record = parsed as { profile?: unknown }
  const name = typeof record.profile === 'string' ? record.profile.trim() : ''

  return name && isDesktopProfileName(name) ? name : null
}

/**
 * Canonical Desktop backend profile identity. Empty, null, and invalid names
 * resolve to `default` — the same mapping `primaryProfileKey()` and the
 * renderer `normalizeProfileKey()` already use. CLI sticky `active_profile`
 * is intentionally not consulted: Desktop must not launch a profile-less
 * child that can land on a different home than routing believes is active.
 */
export function desktopBackendProfileIdentity(profile: unknown): string {
  const value = typeof profile === 'string' ? profile.trim() : ''

  return value && isDesktopProfileName(value) ? value : 'default'
}

export function profileFlagFromArgs(args: readonly string[]): string | null {
  const index = args.indexOf('--profile')

  if (index === -1 || index + 1 >= args.length) {
    return null
  }

  const value = String(args[index + 1] || '').trim()

  return value || null
}

/**
 * Build the canonical headless backend argv (always `serve`).
 * Desktop always pins `--profile <identity>` so argv, ownership metadata, and
 * renderer routing share one name. CLI invocations outside Desktop are unchanged.
 */
export function serveBackendArgs(profile?: unknown) {
  const identity = desktopBackendProfileIdentity(profile)

  return ['--profile', identity, 'serve', '--host', '127.0.0.1', '--port', '0']
}

/**
 * Primary-window spawn plan from stored `active-profile.json` (or its absence).
 * `identity` is what routing / lock / ownership must record; `args` is what
 * the child argv must contain. They are the same name by construction.
 */
export function primaryBackendSpawnPlan(storedFileContents: unknown) {
  const stored = storedFileContents == null ? null : parseStoredDesktopProfile(storedFileContents)
  const identity = desktopBackendProfileIdentity(stored)
  const args = serveBackendArgs(identity)

  return { identity, args }
}

/**
 * Pooled extra-profile spawn plan. Pool backends already pin `--profile`; this
 * helper is the same argv builder so a blank pool key cannot regress to a
 * profile-less child.
 */
export function poolBackendSpawnPlan(profile: unknown) {
  const identity = desktopBackendProfileIdentity(profile)
  const args = serveBackendArgs(identity)

  return { identity, args }
}

/**
 * Rewrite a resolved backend argv from `serve` to the legacy
 * `dashboard --no-open` form, preserving every other argument (incl. a leading
 * `-m hermes_cli.main` and any `--profile <name>`). Returns a copy; if there is
 * no `serve` token the argv is returned unchanged.
 */
export function dashboardFallbackArgs(args) {
  const i = args.indexOf('serve')

  if (i === -1) {
    return args.slice()
  }

  return [...args.slice(0, i), 'dashboard', '--no-open', ...args.slice(i + 1)]
}

/**
 * True when a runtime's `hermes_cli/subcommands/dashboard.py` source registers
 * the `serve` subcommand. Matches `add_parser("serve"` / `add_parser('serve'`
 * specifically so the substring "server" (e.g. "start_server", "web server")
 * never produces a false positive.
 */
export function sourceDeclaresServe(dashboardPySource) {
  return /add_parser\(\s*["']serve["']/.test(String(dashboardPySource || ''))
}
