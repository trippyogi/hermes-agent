import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  awaitSerializedSwitch,
  createSerializedSwitchLatch,
  GatewaySwitchTimeoutError,
  occupySerializedSwitch,
  raceWithTimeout
} from './serialized-switch'

function deferred<T = void>(): { promise: Promise<T>; reject: (error: unknown) => void; resolve: (value: T) => void } {
  let reject!: (error: unknown) => void
  let resolve!: (value: T) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, reject, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('raceWithTimeout', () => {
  it('resolves with the work when it finishes in time', async () => {
    await expect(raceWithTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('rejects with GatewaySwitchTimeoutError when the work never settles', async () => {
    vi.useFakeTimers()
    const hung = raceWithTimeout(new Promise<never>(() => undefined), 25)
    const expectation = expect(hung).rejects.toBeInstanceOf(GatewaySwitchTimeoutError)
    await vi.advanceTimersByTimeAsync(25)
    await expectation
  })
})

describe('serialized switch latch', () => {
  it('a hung occupant blocks later waiters until the timeout, then lets them proceed', async () => {
    vi.useFakeTimers()
    const latch = createSerializedSwitchLatch()

    const first = occupySerializedSwitch(latch, () => new Promise(() => undefined), { timeoutMs: 40 })
    const firstTimeout = expect(first).rejects.toBeInstanceOf(GatewaySwitchTimeoutError)

    const secondWait = awaitSerializedSwitch(latch, 40)

    await vi.advanceTimersByTimeAsync(39)
    expect(latch.pending).not.toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await firstTimeout
    await secondWait
    expect(latch.pending).toBeNull()
  })

  it('abandons an already-expired occupant immediately so a retry does not wait again', async () => {
    const latch = createSerializedSwitchLatch()
    latch.pending = new Promise(() => undefined)
    latch.startedAt = 0

    const abandoned = vi.fn()
    await awaitSerializedSwitch(latch, 20, { now: () => 50, onAbandon: abandoned })

    expect(latch.pending).toBeNull()
    expect(abandoned).toHaveBeenCalledTimes(1)
  })

  it('clears the latch on a rejected occupant so a later switch can start', async () => {
    const latch = createSerializedSwitchLatch()

    await expect(
      occupySerializedSwitch(
        latch,
        async () => {
          throw new Error('descriptor failed')
        },
        { timeoutMs: 50 }
      )
    ).rejects.toThrow('descriptor failed')

    expect(latch.pending).toBeNull()

    await occupySerializedSwitch(latch, async () => undefined, { timeoutMs: 50 })
    expect(latch.pending).toBeNull()
  })

  it('does not let a timed-out occupancy clear a newer occupant', async () => {
    vi.useFakeTimers()
    const latch = createSerializedSwitchLatch()
    const firstWork = deferred()

    const first = occupySerializedSwitch(latch, () => firstWork.promise, { timeoutMs: 20 })
    const firstTimeout = expect(first).rejects.toBeInstanceOf(GatewaySwitchTimeoutError)

    await vi.advanceTimersByTimeAsync(20)
    await firstTimeout
    expect(latch.pending).toBeNull()

    const secondDone = deferred()
    const second = occupySerializedSwitch(latch, () => secondDone.promise, { timeoutMs: 1_000 })
    expect(latch.pending).not.toBeNull()

    firstWork.resolve()
    await Promise.resolve()
    expect(latch.pending).not.toBeNull()

    secondDone.resolve()
    await second
    expect(latch.pending).toBeNull()
  })

  it('calls onAbandon on timeout so a late completion can be invalidated', async () => {
    vi.useFakeTimers()
    const onAbandon = vi.fn()
    const latch = createSerializedSwitchLatch()

    const hung = occupySerializedSwitch(latch, () => new Promise(() => undefined), {
      onAbandon,
      timeoutMs: 15
    })

    const hungTimeout = expect(hung).rejects.toBeInstanceOf(GatewaySwitchTimeoutError)

    await vi.advanceTimersByTimeAsync(15)
    await hungTimeout
    expect(onAbandon).toHaveBeenCalledTimes(1)
  })
})
