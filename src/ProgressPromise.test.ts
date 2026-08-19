import { expect, jest, test } from '@jest/globals'

import ProgressPromise from './ProgressPromise'
import { Progress } from './types'

/**
 * Creates a ProgressPromise together with its executor controls,
 * so tests can drive resolution and progress from the outside.
 */
function createProgressPromise<T = string>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: any) => void
  let progress!: (progress: Progress) => void
  const promise = new ProgressPromise<T>((res, rej, prog) => {
    resolve = res
    reject = rej
    progress = prog
  })
  return { promise, resolve, reject, progress }
}

test('ProgressPromise resolves like a Promise', async () => {
  const { promise, resolve } = createProgressPromise()
  expect(promise).toBeInstanceOf(Promise)
  resolve('done')
  await expect(promise).resolves.toBe('done')
})

test('ProgressPromise rejects like a Promise', async () => {
  const { promise, reject } = createProgressPromise()
  reject(new Error('nope'))
  await expect(promise).rejects.toThrow('nope')
})

test('ProgressPromise starts with initial progress', () => {
  const { promise } = createProgressPromise()
  expect(promise.progress).toEqual({ curr: 0, total: 1 })
})

test('Initial progress total can be set from the constructor', async () => {
  const promise = new ProgressPromise<string>((resolve) => resolve('done'), 10)
  expect(promise.progress).toEqual({ curr: 0, total: 10 })

  // Reported progress replaces the initial total
  const { promise: other, progress, resolve } = createProgressPromise()
  progress({ curr: 1, total: 3 })
  resolve('done')
  await other
  expect(other.progress).toEqual({ curr: 1, total: 3 })
})

test('onProgress requires a function', () => {
  const { promise } = createProgressPromise()
  // @ts-ignore Testing runtime guard
  expect(() => promise.onProgress(42)).toThrow(TypeError)
  // @ts-ignore Testing runtime guard
  expect(() => promise.onProgress(undefined)).toThrow(
    'Expected a `Function`, got `undefined`'
  )
})

test('onProgress is chainable and de-duplicates listeners', async () => {
  const { promise, progress, resolve } = createProgressPromise()
  const listener = jest.fn()
  expect(promise.onProgress(listener)).toBe(promise)
  // Adding the same listener twice should only call it once per update
  promise.onProgress(listener)

  progress({ curr: 1, total: 2 })
  resolve('done')
  await promise

  expect(listener).toBeCalledTimes(1)
  expect(listener).toBeCalledWith({ curr: 1, total: 2 })
})

test('Progress is reported to all listeners, and saved', async () => {
  const { promise, progress, resolve } = createProgressPromise()
  const first = jest.fn()
  const second = jest.fn()
  promise.onProgress(first).onProgress(second)

  // Progress reported from the executor before any listener was registered
  // is still delivered, since delivery waits for the next microtask tick.
  progress({ curr: 1, total: 3, msg: 'working' })
  progress({ curr: 2, total: 3 })
  resolve('done')
  await promise

  expect(first).toBeCalledTimes(2)
  expect(second).toBeCalledTimes(2)
  expect(first).toHaveBeenNthCalledWith(1, { curr: 1, total: 3, msg: 'working' })
  expect(first).toHaveBeenNthCalledWith(2, { curr: 2, total: 3 })
  expect(promise.progress).toEqual({ curr: 2, total: 3 })
})

test('Out-of-order progress is reported but not saved', async () => {
  const { promise, progress, resolve } = createProgressPromise()
  const listener = jest.fn()
  promise.onProgress(listener)

  progress({ curr: 2, total: 3 })
  progress({ curr: 1, total: 3 })
  resolve('done')
  await promise

  expect(listener).toBeCalledTimes(2)
  expect(listener).toHaveBeenLastCalledWith({ curr: 1, total: 3 })
  expect(promise.progress).toEqual({ curr: 2, total: 3 })
})

test('Progress reported after resolve is still delivered', async () => {
  const { promise, progress, resolve } = createProgressPromise()
  const listener = jest.fn()
  promise.onProgress(listener)

  resolve('done')
  await promise
  progress({ curr: 1, total: 1 })
  await Promise.resolve()

  expect(listener).toBeCalledWith({ curr: 1, total: 1 })
  expect(promise.progress).toEqual({ curr: 1, total: 1 })
})

test('Custom progress types are supported', async () => {
  interface StepProgress extends Progress {
    step: string
  }
  const listener = jest.fn()
  // Progress reported synchronously from inside the executor is delivered,
  // even though it happens before `super` has run.
  const promise = new ProgressPromise<string, StepProgress>(
    (resolve, _reject, progress) => {
      progress({ curr: 1, total: 2, step: 'upload' })
      resolve('done')
    }
  ).onProgress(listener)

  await promise
  expect(listener).toBeCalledWith({ curr: 1, total: 2, step: 'upload' })
  expect(promise.progress).toEqual({ curr: 1, total: 2, step: 'upload' })
})

test('Chained promises keep working', async () => {
  const { promise, resolve } = createProgressPromise()
  // Note: `then` is typed as returning a plain Promise, but at runtime the
  // species constructor gives us a ProgressPromise with its own state.
  const chained = promise.then((value) => `${value}!`)
  expect(chained).toBeInstanceOf(ProgressPromise)

  resolve('done')
  await expect(chained).resolves.toBe('done!')
  expect((chained as ProgressPromise<string>).progress).toEqual({
    curr: 0,
    total: 1
  })
})
