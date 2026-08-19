import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  dashboardFallbackArgs,
  desktopBackendProfileIdentity,
  parseStoredDesktopProfile,
  poolBackendSpawnPlan,
  primaryBackendSpawnPlan,
  profileFlagFromArgs,
  serveBackendArgs,
  sourceDeclaresServe
} from './backend-command'

function assertSpawnIdentity(identity: string, args: string[]) {
  assert.equal(identity, desktopBackendProfileIdentity(identity))
  assert.equal(profileFlagFromArgs(args), identity)
  assert.deepEqual(args, ['--profile', identity, 'serve', '--host', '127.0.0.1', '--port', '0'])
}

test('absent active-profile.json pins explicit --profile default', () => {
  const plan = primaryBackendSpawnPlan(undefined)
  assert.equal(parseStoredDesktopProfile(undefined), null)
  assertSpawnIdentity('default', plan.args)
  assert.equal(plan.identity, 'default')
})

test('stored profile null pins explicit --profile default', () => {
  const plan = primaryBackendSpawnPlan({ profile: null })
  assert.equal(parseStoredDesktopProfile({ profile: null }), null)
  assertSpawnIdentity('default', plan.args)
  assert.equal(plan.identity, 'default')
})

test('stored profile empty string pins explicit --profile default', () => {
  const plan = primaryBackendSpawnPlan({ profile: '' })
  assert.equal(parseStoredDesktopProfile({ profile: '' }), null)
  assertSpawnIdentity('default', plan.args)
  assert.equal(plan.identity, 'default')
})

test('stored named profile pins that name in argv and metadata', () => {
  const plan = primaryBackendSpawnPlan({ profile: 'hank' })
  assert.equal(parseStoredDesktopProfile({ profile: 'hank' }), 'hank')
  assertSpawnIdentity('hank', plan.args)
  assert.equal(plan.identity, 'hank')
})

test('missing active-profile.json relaunch still pins --profile default', () => {
  const relaunch = primaryBackendSpawnPlan(null)
  assertSpawnIdentity('default', relaunch.args)
  assert.equal(relaunch.identity, 'default')
})

test('serveBackendArgs never omits --profile, even with no argument', () => {
  assertSpawnIdentity('default', serveBackendArgs())
  assertSpawnIdentity('default', serveBackendArgs(''))
  assertSpawnIdentity('default', serveBackendArgs(null))
  assertSpawnIdentity('worker', serveBackendArgs('worker'))
})

test('pool spawn always includes --profile <profile>', () => {
  assertSpawnIdentity('default', poolBackendSpawnPlan('').args)
  assertSpawnIdentity('default', poolBackendSpawnPlan('default').args)
  assertSpawnIdentity('hank', poolBackendSpawnPlan('hank').args)
  assertSpawnIdentity('apollo', poolBackendSpawnPlan('apollo').args)
  assert.equal(poolBackendSpawnPlan('hank').identity, 'hank')
})

test('dashboardFallbackArgs rewrites serve -> dashboard --no-open, keeping the -m prefix', () => {
  const serve = ['-m', 'hermes_cli.main', 'serve', '--host', '127.0.0.1', '--port', '0']
  assert.deepEqual(dashboardFallbackArgs(serve), [
    '-m',
    'hermes_cli.main',
    'dashboard',
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    '0'
  ])
})

test('dashboardFallbackArgs preserves a --profile flag ahead of serve', () => {
  const serve = ['-m', 'hermes_cli.main', '--profile', 'worker', 'serve', '--host', '127.0.0.1', '--port', '0']
  assert.deepEqual(dashboardFallbackArgs(serve), [
    '-m',
    'hermes_cli.main',
    '--profile',
    'worker',
    'dashboard',
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    '0'
  ])
})

test('dashboardFallbackArgs keeps explicit default identity from serveBackendArgs', () => {
  const rewritten = dashboardFallbackArgs(['-m', 'hermes_cli.main', ...serveBackendArgs()])
  assert.equal(profileFlagFromArgs(rewritten), 'default')
  assert.ok(rewritten.includes('dashboard'))
  assert.ok(!rewritten.includes('serve'))
})

test('dashboardFallbackArgs is a no-op (copy) when there is no serve token', () => {
  const args = ['-m', 'hermes_cli.main', 'dashboard', '--no-open']
  const out = dashboardFallbackArgs(args)
  assert.deepEqual(out, args)
  assert.notEqual(out, args, 'should return a copy, not the same reference')
})

test('sourceDeclaresServe detects the serve subparser registration', () => {
  assert.equal(sourceDeclaresServe('subparsers.add_parser("serve", help="...")'), true)
  assert.equal(sourceDeclaresServe("subparsers.add_parser('serve')"), true)
  assert.equal(sourceDeclaresServe('subparsers.add_parser(\n        "serve",\n)'), true)
})

test('sourceDeclaresServe does not false-positive on the substring "server"', () => {
  const oldSource = `
    dashboard_parser = subparsers.add_parser("dashboard", help="Start the web UI dashboard")
    from hermes_cli.web_server import start_server  # web server
  `

  assert.equal(sourceDeclaresServe(oldSource), false)
})
