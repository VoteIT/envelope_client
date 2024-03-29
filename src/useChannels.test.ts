import { test } from '@jest/globals'

import useChannels, { Subscription, count } from './useChannels'
import { sleep } from './Socket.test'
import { SocketEventHandler } from 'types'

test('count', () => {
  const ids = count()
  expect(ids.next().value).toBe(1)
  expect(ids.next().value).toBe(2)
})

test('Subscription objects', () => {
  const subscription = new Subscription({
    channel_type: 'test',
    pk: 42
  })
  expect(subscription.shouldSubscribe).toBe(false)
  subscription.add(1)
  expect(subscription.shouldSubscribe).toBe(true)
  subscription.add(42)
  subscription.delete(1)
  expect(subscription.shouldSubscribe).toBe(true)
  subscription.status = 2 // Suscribed
  expect(subscription.shouldSubscribe).toBe(false)
  expect(subscription.shouldLeave).toBe(false)
  subscription.delete(42)
  expect(subscription.shouldLeave).toBe(true)
})

function useMockedChannels(isOpen: boolean) {
  const mockSocket = {
    isOpen,
    messageID: 1,
    // @ts-ignore
    call: jest.fn(() => Promise.resolve()),
    send: jest.fn(),
    on: jest.fn()
  }
  const subscribedCallback = jest.fn()

  const { getSubscribedChannels, onSubscriptionChanged, subscribe } =
    // @ts-ignore
    useChannels(mockSocket)
  onSubscriptionChanged(subscribedCallback)
  return {
    mockSocket,
    subscribedCallback,
    getSubscribedChannels,
    subscribe
  }
}

test('useChannels subscription commands', async () => {
  const { mockSocket, subscribedCallback, subscribe } = useMockedChannels(true)

  const s1 = subscribe('test', 42)
  await s1.promise
  expect(mockSocket.call).toBeCalledWith('channel.subscribe', {
    channel_type: 'test',
    pk: 42
  })
  expect(subscribedCallback).toBeCalledWith(
    expect.objectContaining({ subscribed: true })
  )
  const s2 = subscribe('test', 42)
  await s2.promise
  expect(mockSocket.call).toBeCalledTimes(1)
  s1.leave(0)
  await sleep() // nextTick
  expect(mockSocket.call).toBeCalledTimes(1)
  // Test the leave delay
  s2.leave(10)
  await sleep() // nextTick
  expect(mockSocket.send).not.toBeCalled()
  expect(subscribedCallback).toBeCalledTimes(1)
  await sleep(10)
  expect(subscribedCallback).toBeCalledWith(
    expect.objectContaining({ subscribed: false })
  )
  expect(mockSocket.send).toBeCalledWith('channel.leave', {
    channel_type: 'test',
    pk: 42
  })
})

test('useChannels deferred subscriptions', async () => {
  const { mockSocket, subscribedCallback, subscribe } = useMockedChannels(false)

  const readyHandler: SocketEventHandler = mockSocket.on.mock.calls[0][1]
  await subscribe('test', 42).promise
  expect(mockSocket.call).not.toBeCalled()
  expect(subscribedCallback).not.toBeCalled()

  // Open up the mock socket.
  mockSocket.isOpen = true
  readyHandler({ readyState: WebSocket.OPEN })
  await sleep()

  expect(mockSocket.call).toBeCalledWith('channel.subscribe', {
    channel_type: 'test',
    pk: 42
  })
  expect(subscribedCallback).toBeCalledWith(
    expect.objectContaining({ subscribed: true })
  )
})

test('useChannels subscription commands', async () => {
  const { getSubscribedChannels, subscribe } = useMockedChannels(true)

  await subscribe('test', 1).promise
  await subscribe('test', 42).promise
  const subscribed = [...getSubscribedChannels()]
  expect(subscribed.length).toBe(2)
  expect(subscribed[1]).toEqual({ channelType: 'test', pk: 42 })
})

test('useChannels single subscribe command', async () => {
  const { getSubscribedChannels, mockSocket, subscribe } =
    useMockedChannels(true)
  await Promise.all([
    subscribe('test', 1).promise,
    subscribe('test', 1).promise
  ])
  const subscribed = [...getSubscribedChannels()]
  expect(subscribed.length).toBe(1)
  expect(mockSocket.call).toBeCalledTimes(1)
})

test('useChannels single leave command', async () => {
  const channelLeftCall = {
    channelType: 'test',
    pk: 1,
    subscribed: false
  }
  const { getSubscribedChannels, subscribe, subscribedCallback } =
    useMockedChannels(true)
  const subscriptions = [subscribe('test', 1), subscribe('test', 1)]
  await Promise.all(subscriptions.map((s) => s.promise))
  subscriptions[0].leave(0)
  await sleep()
  expect([...getSubscribedChannels()].length).toBe(1)
  expect(subscribedCallback).not.toBeCalledWith(channelLeftCall)
  subscriptions[1].leave(0)
  await sleep()
  expect([...getSubscribedChannels()].length).toBe(0)
  expect(subscribedCallback).toBeCalledWith(channelLeftCall)
})
