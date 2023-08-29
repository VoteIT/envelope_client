import type Socket from './Socket'

export enum State {
  Success = 's',
  Failed = 'f',
  Queued = 'q',
  Running = 'r',
}

export interface Progress {
  curr: number
  total: number
  msg?: string
}

export interface BaseChannelsMessage {
  t: string
  i: string | null
}

export interface SuccessMessage<T> extends BaseChannelsMessage {
  s?: State.Success
  p: T
}

export interface ProgressMessage extends BaseChannelsMessage {
  s: State.Running | State.Queued
  p: Progress | null
}

export interface PydanticError {
  loc: string[]
  msg: string
  type: string
}

export interface ErrorPayload {
  msg: string
}

export interface ValidationErrorPayload extends ErrorPayload {
  msg: string
  errors: PydanticError[]
}

export interface FailedMessage extends BaseChannelsMessage {
  s: State.Failed
  p: ValidationErrorPayload | ErrorPayload
}

export function isValidationErrorPayload (p: FailedMessage['p']): p is ValidationErrorPayload {
  return 'errors' in p
}

export interface SubscribePayload {
  channel_type: string
  pk: number
}

export interface SubscribedPayload {
  app_state: SuccessMessage<object>[] | null
  channel_name: string
  channel_type: string
  pk: number
}

export interface BatchPayload {
  t: string
  payloads: object[]
}
export interface BatchMessage extends BaseChannelsMessage {
  p: BatchPayload
}

export type ChannelsMessage<T=unknown> = SuccessMessage<T> | ProgressMessage | FailedMessage

export type TypeHandler<T=unknown> = (data: ChannelsMessage<T>) => void

export type ProgressHandler<PT extends Progress=Progress> = (progress: PT) => void

export type SocketEvent = 'readyState'
type ReadyStateChangedEvent = { readyState: WebSocket['readyState'] }
export type SocketEventHandler = (event: ReadyStateChangedEvent) => void

// For Socket.ts
export interface ChannelsConfig {
  timeout?: number
}

export interface Heartbeat {
  callback (socket: Socket): void
  direction?: 'incoming' | 'outgoing'
  ms: number
  intervalID?: NodeJS.Timeout
}

export interface SocketOptions {
  config?: ChannelsConfig
  debug?: boolean
  manual?: boolean
}

export interface SubscriptionOptions {
  leaveDelay?: number
}
