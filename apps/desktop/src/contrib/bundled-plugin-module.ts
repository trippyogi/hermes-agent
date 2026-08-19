/**
 * Resolve a Vite/Rolldown glob module to a `HermesPlugin`.
 *
 * Bundled discovery is renderer-local: if the plugin is already in the
 * renderer graph, it belongs in Settings → Plugins and may register. Connection
 * mode (local vs remote gateway) and OS must not gate that — a Windows desktop
 * pointed at a Linux gateway still inventories `hermes-bots` when the bundle
 * contains it. Disk-only plugins stay on the Electron-local doors (#66899).
 *
 * Glob values are not a single shape. Eager ESM is usually `{ default: plugin }`,
 * `{ import: 'default' }` yields the plugin itself, and CJS/Rolldown interop
 * sometimes nests another `default`. Reading only `mod.default` skips a valid
 * `.js` plugin that is already in the bundle — the Settings inventory then
 * shows Kanban (tsx) but no Bots.
 */

import type { HermesPlugin } from './plugin'

const MAX_DEFAULT_UNWRAP = 3

function isHermesPlugin(value: unknown): value is HermesPlugin {
  if (!value || typeof value !== 'object') {
    return false
  }

  const rec = value as { id?: unknown; register?: unknown }

  return typeof rec.id === 'string' && rec.id.length > 0 && typeof rec.register === 'function'
}

/** Unwrap Vite/Rolldown glob interop until a `HermesPlugin` appears. */
export function resolveBundledPluginModule(mod: unknown): HermesPlugin | null {
  const seen = new Set<unknown>()
  let current = mod

  for (let depth = 0; depth < MAX_DEFAULT_UNWRAP && current != null && !seen.has(current); depth++) {
    seen.add(current)

    if (isHermesPlugin(current)) {
      return current
    }

    if (typeof current !== 'object' || !('default' in current)) {
      return null
    }

    current = (current as { default: unknown }).default
  }

  return isHermesPlugin(current) ? current : null
}

export interface BundledPluginExport {
  path: string
  plugin: HermesPlugin
}

/** Map a glob result to the plugins that should enter the desktop inventory. */
export function listBundledPluginExports(modules: Record<string, unknown>): BundledPluginExport[] {
  const found: BundledPluginExport[] = []

  for (const [path, mod] of Object.entries(modules)) {
    const plugin = resolveBundledPluginModule(mod)

    if (plugin) {
      found.push({ path, plugin })
    }
  }

  return found
}
