import type Socket from "./Socket"
import { EnvelopeChannel, SubscriptionOptions } from "./types"

type ChannelLeaveHandler = (channelType: string, pk: number) => void

const SubscriptionStatus = {
  None: 0,
  Subscribing: 1,
  Subscribed: 2,
} as const

const DEFAULT_OPTIONS: SubscriptionOptions = {
  leaveDelay: 5_000
}

export function * count (): Generator<number, number> {
  let n = 0
  while (true) {
    yield ++n
  }
}

/**
 * Describes individual subscription paths
 */
export class Subscription extends Set<number> {
  public readonly channel: EnvelopeChannel
  public leaveTimeout?: NodeJS.Timeout
  public status: typeof SubscriptionStatus[keyof typeof SubscriptionStatus]

  constructor (channel: EnvelopeChannel) {
    super()
    this.channel = channel
    this.status = SubscriptionStatus.None
  }

  /**
   * This means that a leave command should be sent
   */
  public get shouldLeave () {
    return !this.size && this.status === SubscriptionStatus.Subscribed
  }

  /**
   * This means that a subscribe command should be sent
   */
  public get shouldSubscribe () {
    return !!this.size && this.status !== SubscriptionStatus.Subscribed
  }
}

export default function useChannels (socket: Socket, opts?: SubscriptionOptions) {
  const leaveHandlers: ChannelLeaveHandler[] = []
  const options = { ...DEFAULT_OPTIONS, ...opts }
  const subscriptions = new Map<string, Subscription>()
  const subscriptionIds = count()

  function getSubscription (channel: EnvelopeChannel) {
    const path = `${channel.channel_type}/${channel.pk}`
    if (!subscriptions.has(path)) {
      subscriptions.set(
        path,
        new Subscription(channel)
      )
    }
    return subscriptions.get(path)!
  }

  async function performLeave (subscription: Subscription) {
    // Do not wait for response
    socket.send('channel.leave', subscription.channel)
    subscription.status = SubscriptionStatus.None
    for (const handler of leaveHandlers) {
      handler(
        subscription.channel.channel_type,
        subscription.channel.pk,
      )
    }
  }
  async function performSubscribe (subscription: Subscription) {
    subscription.status = SubscriptionStatus.Subscribing
    await socket.call('channel.subscribe', subscription.channel)
    subscription.status = SubscriptionStatus.Subscribed
  }

  function subscribe (channel_type: string, pk: number) {
    // TODO Cancel any leave timeouts
    const channel = { channel_type, pk }
    const id = subscriptionIds.next().value
    const subscription = getSubscription(channel)
    subscription.add(id)
    clearTimeout(subscription.leaveTimeout)

    function leave (delay?: number) {
      subscription.delete(id)
      if (!subscription.shouldLeave) return
      clearTimeout(subscription.leaveTimeout)
      delay = typeof delay === 'number'
        ? delay
        : options.leaveDelay
      subscription.leaveTimeout = setTimeout(
        () => performLeave(subscription),
        delay
      )
    }

    const promise = subscription.shouldSubscribe
      ? performSubscribe(subscription)
      : Promise.resolve()
    return {
      promise,
      leave
    }
  }

  function onLeave (handler: ChannelLeaveHandler) {
    leaveHandlers.push(handler)
  }

  return {
    onLeave,
    subscribe
  }
}
