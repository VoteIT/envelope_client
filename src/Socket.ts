import ProgressPromise from './ProgressPromise'
import { ValidationError } from './errors'
import {
  BatchMessage,
  BatchPayload,
  ChannelsConfig,
  ChannelsMessage,
  Heartbeat,
  Progress,
  SocketEvent,
  SocketEventHandler,
  SocketOptions,
  State,
  SubscribedPayload,
  SuccessMessage,
  TypeHandler,
  isValidationErrorPayload
} from './types'
import useChannels from './useChannels'

const DEFAULT_CONFIG: ChannelsConfig = {
  timeout: 20_000 // 20 s, longer than server's 15 s
}

function isBatchMessage(msg: ChannelsMessage): msg is BatchMessage {
  return msg.t === 's.batch'
}

function isSubscribedMessage(
  msg: ChannelsMessage
): msg is SuccessMessage<SubscribedPayload> {
  return msg.s === State.Success && msg.t === 'channel.subscribed'
}

export default class Socket {
  public messageID: number = 0

  private callbacks: Map<string, (data: ChannelsMessage) => void>
  private callConfig: ChannelsConfig
  // Actually only one event at this time, so this simple syntax works
  private eventHandlers: Record<SocketEvent, SocketEventHandler[]>
  private heartbeats: Heartbeat[]
  private options: SocketOptions
  private _readyState?: WebSocket['readyState']
  private typeHandlers: Partial<Record<string, TypeHandler[]>>
  private url: string | URL
  private ws?: WebSocket
  public channels: ReturnType<typeof useChannels>

  constructor(url: string | URL, opts?: SocketOptions) {
    this.callbacks = new Map()
    this.callConfig = { ...DEFAULT_CONFIG, ...opts?.config }
    this.eventHandlers = {
      readyState: []
    }
    this.heartbeats = []
    this.options = opts || {}
    this.channels = useChannels(this)
    this.typeHandlers = {}
    this.url = url
    if (!opts?.manual) this.connect()

    // 's' == system
    this.addTypeHandler('s', (message) => {
      if (isBatchMessage(message)) this.handleBatchMessage(message.p, message.i)
    })
  }

  public get readyState() {
    return this.ws?.readyState
  }

  // Batch messages allows sending a group of messages that are handled in the same tick,
  // to avoid triggering Vue component updates on each added object
  private handleBatchMessage({ t, payloads }: BatchPayload, i: string | null) {
    const [contentType] = t.split('.')
    // const listener = this.typeListeners.get(contentType)
    const handlers = this.typeHandlers[contentType]
    if (!handlers) {
      if (this.options.debug)
        console.warn(`No handlers registered for batch message ${t}`)
      return
    }
    for (const handler of handlers)
      for (const p of payloads) handler({ t, i, p })
  }

  public on(eventName: SocketEvent, handler: SocketEventHandler) {
    this.eventHandlers[eventName].push(handler)
  }

  public off(eventName: SocketEvent, handler: SocketEventHandler) {
    this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(
      (_handler) => _handler !== handler
    )
  }

  /**
   * Registers a type listener. Each type can only have one listener.
   * There is no way of removing of type listeners. Just register another one to replace.
   * @param name Unique type name
   * @param listener Event handler
   */
  // public registerTypeListener (name: string, listener: (data: ChannelsMessage) => void) {
  //   this.typeListeners.set(name, listener)
  // }

  public addTypeHandler(name: string, handler: TypeHandler) {
    let handlers = this.typeHandlers[name] || []
    // Check if already registered?
    if (handlers.find((h) => h === handler)) return
    this.typeHandlers[name] = [...handlers, handler]
  }

  public removeTypeHandler(name: string, handler: TypeHandler) {
    const handlers = this.typeHandlers[name]
    if (!handlers) return
    this.typeHandlers[name] = handlers.filter((h) => h !== handler)
  }

  private updateReadyState() {
    if (this.readyState === undefined || this._readyState === this.readyState)
      return
    this._readyState = this.readyState
    for (const handler of this.eventHandlers.readyState)
      handler({ readyState: this.readyState })
  }

  public connect() {
    this.ws = new WebSocket(this.url)
    this.updateReadyState()

    this.ws.onerror = this.updateReadyState.bind(this)
    this.ws.onclose = () => {
      this.updateReadyState()
      this.heartbeat('off')
    }
    this.ws.onopen = () => {
      this.updateReadyState()
      this.heartbeat('incoming')
      this.heartbeat('outgoing')
    }
    this.ws.onmessage = (event) => {
      this.updateReadyState()
      this.heartbeat('incoming')
      const msg: ChannelsMessage = JSON.parse(event.data)
      // If there's a listener for message identifier
      if (msg.i) this.callbacks.get(msg.i)?.(msg)
      // If it's a subscribed response, handle any app_state
      if (isSubscribedMessage(msg)) {
        // Send before app state event
        this.options.beforeAppStateHandler?.({
          channelType: msg.p.channel_type,
          pk: msg.p.pk
        })
        for (const payload of msg.p.app_state ?? [])
          this.handleTypeMessage(payload)
      }
      // Else handle type message
      else this.handleTypeMessage(msg)
    }
  }

  private handleTypeMessage(msg: ChannelsMessage) {
    if (!msg.t) return
    const type = msg.t.split('.')[0]
    const handlers = this.typeHandlers[type] || []
    if (this.options.debug && !handlers.length)
      console.warn(`No handler for message of type '${type}'`)
    for (const handler of handlers) {
      handler(msg)
    }
  }

  public close() {
    // Unregister listeners here?
    if (!this.ws) return
    this.ws.onopen = () => {
      throw new Error('Undead socket detected')
    }
    this.ws.onmessage = null
    this.ws.onerror = null
    this.ws.onclose = null
    this.ws.close()
    this.updateReadyState()
  }

  public get isOpen() {
    return this.readyState === WebSocket.OPEN
  }

  private async assertOpen() {
    if (!this.isOpen)
      throw new Error(`Socket not open (readyState ${this.readyState})`)
  }

  /**
   * Sends a message to server and register a response listener.
   * Handles response timeouts. Awaitable.
   * @param t type
   * @param p payload
   * @returns ProgressPromise
   */
  public call<T, PT extends Progress = Progress>(
    t: string,
    p?: object,
    config?: ChannelsConfig
  ): ProgressPromise<SuccessMessage<T>, PT> {
    // Registers a response listener and returns promise that resolves or rejects depeding on subsequent
    // socket data, or times out.
    this.assertOpen()
    this.heartbeat('outgoing')
    const myConfig: ChannelsConfig = { ...this.callConfig, ...config }
    const i = String(++this.messageID)
    this.ws?.send(
      JSON.stringify({
        t,
        i,
        p
      })
    )
    return new ProgressPromise((resolve, reject, progress) => {
      let timeoutId: NodeJS.Timeout
      const setRejectTimeout = () => {
        if (!myConfig.timeout) return
        timeoutId = setTimeout(() => {
          this.callbacks.delete(i)
          reject(new Error('Request timed out'))
        }, myConfig.timeout)
      }
      setRejectTimeout()

      this.callbacks.set(i, (data) => {
        clearTimeout(timeoutId)
        switch (data.s) {
          case State.Failed:
            this.callbacks.delete(i)
            reject(
              isValidationErrorPayload(data.p)
                ? new ValidationError(data.p.msg, data.p.errors)
                : new Error(data.p.msg)
            )
            break
          case State.Queued:
          case State.Running:
            // If we get progress, we reset timeout watcher
            setRejectTimeout()
            if (data.p) progress(data.p as PT)
            break
          case State.Success:
            this.callbacks.delete(i)
            resolve(data as SuccessMessage<T>)
            break
          default: // Should never happen
            this.callbacks.delete(i)
            reject(new Error(`Unknown socket state: ${data}`))
        }
      })
    })
  }

  /**
   * Send a message to server, without listening to response
   * @param t type
   * @param p payload
   */
  public send(t: string, p?: object) {
    // Does not register a response listener
    this.assertOpen()
    this.heartbeat('outgoing')
    this.ws?.send(JSON.stringify({ t, p }))
  }

  /**
   * Respond to message from server
   * @param t type
   * @param i id of message we're responding to
   * @param s state
   * @param p payload
   */
  public respond(
    t: string,
    i: string | null,
    s: State = State.Success,
    p?: object
  ) {
    this.assertOpen()
    this.heartbeat('outgoing')
    this.ws?.send(JSON.stringify({ t, i, p, s }))
  }

  /* Heartbeat handling */
  public addHeartbeat(
    callback: Heartbeat['callback'],
    ms: number,
    direction?: Heartbeat['direction']
  ) {
    // Should not trigger before readyState is open
    const intervalID =
      this.readyState === WebSocket.OPEN
        ? setInterval(() => callback(this), ms)
        : undefined
    this.heartbeats.push({
      callback,
      direction,
      ms,
      intervalID
    })
  }

  public removeHeartbeat(callback: Heartbeat['callback']) {
    const finder = (beat: Heartbeat) => beat.callback === callback
    const heartbeat = this.heartbeats.find(finder)
    if (!heartbeat) return
    // Clear timeout and drop from heartbeats
    clearInterval(heartbeat.intervalID)
    this.heartbeats = this.heartbeats.filter((beat) => !finder(beat))
  }

  private heartbeat(direction: NonNullable<Heartbeat['direction']> | 'off') {
    if (direction === 'off') {
      for (const beat of this.heartbeats) {
        clearInterval(beat.intervalID)
      }
      return
    }
    for (const heartbeat of this.heartbeats) {
      // Skip if heartbeat has a direction that doesn't match
      if (heartbeat.direction && heartbeat.direction !== direction) continue
      // Reset interval
      clearInterval(heartbeat.intervalID)
      heartbeat.intervalID = setInterval(
        () => heartbeat.callback(this),
        heartbeat.ms
      )
    }
  }
}
