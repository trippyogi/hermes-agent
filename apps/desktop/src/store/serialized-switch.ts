// One-at-a-time async occupancy with a timeout. A module-global pending
// promise is the right mutex for "don't race two profile activations", but
// without a deadline a hang latches every later caller behind the same
// never-settling promise — the user clicks again and nothing happens until
// process restart. This helper is the DI-testable contract for that latch.

export const DEFAULT_GATEWAY_SWITCH_TIMEOUT_MS = 20_000

export class GatewaySwitchTimeoutError extends Error {
  readonly name = 'GatewaySwitchTimeoutError'
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Gateway switch timed out after ${timeoutMs}ms`)
    this.timeoutMs = timeoutMs
  }
}

export interface SerializedSwitchLatch {
  pending: null | Promise<unknown>
  startedAt: null | number
}

export function createSerializedSwitchLatch(): SerializedSwitchLatch {
  return { pending: null, startedAt: null }
}

export function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GatewaySwitchTimeoutError(timeoutMs))
    }, timeoutMs)

    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export interface SerializedSwitchWaitOptions {
  now?: () => number
  onAbandon?: () => void
}

/**
 * Wait out the current occupant, if any. A hang past `timeoutMs` (or an
 * occupant that has already been running that long) drops the latch so a
 * new switch can start. The abandoned work is left running; callers must
 * make a late completion a no-op (epoch / identity guard).
 */
export async function awaitSerializedSwitch(
  latch: SerializedSwitchLatch,
  timeoutMs: number,
  options: SerializedSwitchWaitOptions = {}
): Promise<void> {
  const previous = latch.pending

  if (!previous) {
    return
  }

  const now = options.now ?? Date.now
  const elapsed = latch.startedAt == null ? 0 : Math.max(0, now() - latch.startedAt)
  const remaining = timeoutMs - elapsed

  if (remaining <= 0) {
    if (latch.pending === previous) {
      latch.pending = null
      latch.startedAt = null
    }

    options.onAbandon?.()

    return
  }

  try {
    await raceWithTimeout(previous, remaining)
  } catch {
    if (latch.pending === previous) {
      latch.pending = null
      latch.startedAt = null
    }

    options.onAbandon?.()
  }
}

export interface SerializedSwitchOccupyOptions extends SerializedSwitchWaitOptions {
  timeoutMs: number
}

/**
 * Run `work` as the current occupant. Always clears this occupancy when it
 * settles or times out, even if a later occupancy has already taken the slot
 * (identity check). A timeout rejects with GatewaySwitchTimeoutError and
 * calls `onAbandon` so a late completion cannot publish.
 */
export async function occupySerializedSwitch(
  latch: SerializedSwitchLatch,
  work: () => Promise<void>,
  options: SerializedSwitchOccupyOptions
): Promise<void> {
  const now = options.now ?? Date.now
  const occupancy = work()
  // Timeout settles `timed` while `work` keeps running. A later rejection
  // from the abandoned work must not become an unhandled rejection.
  void occupancy.catch(() => undefined)
  const timed = raceWithTimeout(occupancy, options.timeoutMs)

  latch.pending = timed
  latch.startedAt = now()

  try {
    await timed
  } catch (error) {
    if (error instanceof GatewaySwitchTimeoutError) {
      options.onAbandon?.()
    }

    throw error
  } finally {
    if (latch.pending === timed) {
      latch.pending = null
      latch.startedAt = null
    }
  }
}
