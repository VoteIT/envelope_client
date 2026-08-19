import { Progress, ProgressHandler } from './types'

const DEFAULT_TOTAL = 1

/**
 * A Promise that can also report progress while it's pending.
 * The executor gets a third argument, `progress`, for reporting updates.
 * @typeParam T Resolved value type
 * @typeParam PT Progress type, if extended with extra data
 */
export default class ProgressPromise<
  T,
  PT extends Progress = Progress
> extends Promise<T> {
  private currentProgress: Progress
  private listeners: Set<ProgressHandler<PT>>

  /**
   * @param executor Like a Promise executor, but with an added `progress`
   * callback for reporting progress to listeners
   * @param total Expected total of the initial progress, before anything is
   * reported. Defaults to 1.
   */
  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void,
      progress: (progress: PT) => void
    ) => void,
    total: number = DEFAULT_TOTAL
  ) {
    const setProgress = (progress: PT) => {
      // We wait for the next microtask tick so `super` is called before we use
      // `this`. Note: this must stay a `then` callback rather than an `async`
      // IIFE, since downlevelled `async` reads `this` synchronously.
      Promise.resolve().then(() => {
        // Note: we don't really have guarantees over
        // the order in which async operations are evaluated,
        // so if we get an out-of-order progress, we won't save it.
        if (progress.curr >= this.currentProgress.curr)
          this.currentProgress = progress
        for (const listener of this.listeners) {
          listener(progress)
        }
      })
    }

    super(
      (
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: any) => void
      ) => {
        executor(resolve, reject, setProgress)
      }
    )

    this.listeners = new Set()
    this.currentProgress = { curr: 0, total }
  }

  /**
   * Latest reported progress. Out-of-order updates are ignored here.
   */
  get progress() {
    return this.currentProgress
  }

  /**
   * Registers a progress listener. Chainable.
   * Listeners are never removed, and each one is only registered once.
   * @param callback Called with every reported progress, in the order reported
   * @returns This promise
   */
  public onProgress(callback: ProgressHandler<PT>) {
    if (typeof callback !== 'function') {
      throw new TypeError(`Expected a \`Function\`, got \`${typeof callback}\``)
    }

    this.listeners.add(callback)
    return this
  }
}
