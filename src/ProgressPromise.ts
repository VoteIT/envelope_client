import { Progress, ProgressHandler } from './types'

const PROGRESS_INITIAL: Progress = {
  curr: 0,
  total: 1
}

export default class ProgressPromise<T, PT extends Progress=Progress> extends Promise<T> {
  _progress: Progress
  _listeners: Set<ProgressHandler<PT>>
  _setProgress: ProgressHandler<PT>

  constructor (
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void,
      progress: (progress: PT) => void
    ) => void) {
    const setProgress = (progress: PT) => {
      (async () => {
        // We wait for the next microtask tick so `super` is called before we use `this`
        await Promise.resolve()

        // Note: we don't really have guarantees over
        // the order in which async operations are evaluated,
        // so if we get an out-of-order progress, we won't save it.
        if (progress.curr >= this._progress.curr) this._progress = progress
        for (const listener of this._listeners) {
          listener(progress)
        }
      })()
    }

    super((
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void
    ) => {
      executor(
        resolve,
        reject,
        setProgress
      )
    })

    this._listeners = new Set()
    this._setProgress = setProgress
    this._progress = PROGRESS_INITIAL
  }

  get progress () {
    return this._progress
  }

  public onProgress (callback: ProgressHandler<PT>) {
    if (typeof callback !== 'function') {
      throw new TypeError(`Expected a \`Function\`, got \`${typeof callback}\``)
    }

    this._listeners.add(callback)
    return this
  }
}
