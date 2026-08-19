import { describe, expect, it } from 'vitest'

import { listBundledPluginExports, resolveBundledPluginModule } from './bundled-plugin-module'
import type { HermesPlugin } from './plugin'

const plugin = (id: string, name?: string): HermesPlugin => ({
  id,
  name,
  register: () => undefined
})

describe('resolveBundledPluginModule', () => {
  it('accepts the plugin object itself ({ import: "default" } glob shape)', () => {
    const bots = plugin('hermes-bots', 'Bots')

    expect(resolveBundledPluginModule(bots)).toBe(bots)
  })

  it('accepts a single default wrapper (typical eager ESM glob)', () => {
    const bots = plugin('hermes-bots', 'Bots')

    expect(resolveBundledPluginModule({ default: bots })).toBe(bots)
  })

  it('accepts a nested default wrapper (CJS / Rolldown interop)', () => {
    const bots = plugin('hermes-bots', 'Bots')

    expect(resolveBundledPluginModule({ default: { default: bots } })).toBe(bots)
  })

  it('rejects a glob module with no HermesPlugin export', () => {
    expect(resolveBundledPluginModule({ default: { id: 'almost' } })).toBeNull()
    expect(resolveBundledPluginModule({ default: {} })).toBeNull()
    expect(resolveBundledPluginModule(undefined)).toBeNull()
  })
})

describe('listBundledPluginExports', () => {
  it('inventories a bundled js plugin from the renderer graph on Windows + remote', () => {
    // The glob already ran in the renderer. Discovery must not consult OS or
    // connection mode — those would hide Bot Mode on Windows Desktop → remote
    // Linux gateway even when the bundle contains the plugin (#89591).
    const bots = plugin('hermes-bots', 'Bots')
    const kanban = plugin('kanban', 'Kanban')
    const rows = listBundledPluginExports({
      '../plugins/hermes-bots/plugin.js': { default: { default: bots } },
      '../plugins/kanban/plugin.tsx': { default: kanban }
    })

    expect(rows.map(row => row.plugin.id)).toEqual(['hermes-bots', 'kanban'])
    expect(rows.map(row => row.plugin.name)).toEqual(['Bots', 'Kanban'])
  })

  it('skips glob entries that are not a HermesPlugin so a broken neighbor cannot hide others', () => {
    const kanban = plugin('kanban', 'Kanban')
    const rows = listBundledPluginExports({
      '../plugins/broken/plugin.js': { default: { id: 'broken' } },
      '../plugins/kanban/plugin.tsx': { default: kanban }
    })

    expect(rows.map(row => row.plugin.id)).toEqual(['kanban'])
  })
})
