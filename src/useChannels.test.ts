import { test } from '@jest/globals'

import useChannels, { Subscription, count } from './useChannels'
import { sleep } from './Socket.test'

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

test('useChannels subscription commands', async () => {
  // @ts-ignore
  const mockSocket: Parameters<typeof useChannels>[0] = {
    messageID: 1,
    // @ts-ignore
    call: jest.fn(() => Promise.resolve()),
    send: jest.fn()
  }

  const { subscribe } = useChannels(mockSocket)
  const s1 = subscribe('test', 42)
  await s1.promise
  expect(mockSocket.call).toBeCalledWith(
    'channel.subscribe',
    {
      channel_type: 'test',
      pk: 42
    }
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
  await sleep(10)
  expect(mockSocket.send).toBeCalledWith(
    'channel.leave',
    {
      channel_type: 'test',
      pk: 42
    }
  )
})
