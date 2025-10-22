import { expect, jest, test } from '@jest/globals'
import WS from 'jest-websocket-mock'

import Socket from './Socket'
import { SocketOptions } from './types'

/* Tests using  https://www.npmjs.com/package/jest-websocket-mock */

/**
 * Awaitable sleep function
 * @param ms Milliseconds to sleep - leave empty for nextTick
 */
export function sleep(ms: number = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function createSocket(opts?: SocketOptions) {
  // create a WS instance, listening on port 1234 on localhost
  const server = new WS('ws://localhost:1234', { jsonProtocol: true })
  const socket = new Socket('ws://localhost:1234', opts)
  if (!opts?.manual) await server.connected // wait for the server to have established the connection
  return {
    server,
    socket
  }
}

test('WebSocket type message', async () => {
  const { server, socket } = await createSocket()

  const handler = jest.fn()
  socket.addTypeHandler('test', handler)

  server.send({ t: 'test.message' })
  expect(handler).toBeCalledWith({ t: 'test.message' })

  server.send({
    t: 's.batch',
    i: '1',
    p: {
      t: 'test.batch',
      payloads: [null, null]
    }
  })
  expect(handler).toBeCalledWith({ t: 'test.batch', i: '1', p: null })
  expect(handler).toBeCalledTimes(3)

  socket.removeTypeHandler('test', handler)
  server.send({ t: 'test.none' })
  expect(handler).not.toBeCalledWith({ t: 'test.none' })

  // The WS class also has a static "clean" method to gracefully close all open connections,
  // particularly useful to reset the environment between test runs.
  WS.clean()
})

test('WebSocket readyState lifecycle', async () => {
  const { server, socket } = await createSocket({ manual: true })
  const eventHandler = jest.fn()
  socket.on('readyState', eventHandler)

  expect(eventHandler).not.toBeCalled()

  socket.connect()
  expect(eventHandler).toBeCalledWith({ readyState: WebSocket.CONNECTING })

  await server.connected
  expect(eventHandler).toBeCalledWith({ readyState: WebSocket.OPEN })

  server.close()
  expect(eventHandler).toBeCalledWith({ readyState: WebSocket.CLOSED })
  expect(eventHandler).toBeCalledTimes(3)

  WS.clean()
})

test('WebSocket connection refused', async () => {
  const { server, socket } = await createSocket({ manual: true })
  server.on('connection', (socket) => {
    socket.close({ wasClean: false, code: 1003, reason: 'NOPE' })
  })

  socket.connect()
  expect(socket.readyState).toBe(WebSocket.CONNECTING)

  await server.connected
  expect(socket.readyState).toBe(WebSocket.CLOSING)

  await server.closed
  expect(socket.readyState).toBe(WebSocket.CLOSED)

  WS.clean()
})

test('WebSocket failure', async () => {
  const { server, socket } = await createSocket()
  server.error()
  expect(socket.readyState).toBe(WebSocket.CLOSED)

  WS.clean()
})

/*
 * This test relies heavily on timings.
 * It should have plenty of margin, but might fail on a busy computer.
 */
test('WebSocket heartbeat', async () => {
  const cb = {
    any: jest.fn(),
    in: jest.fn(),
    out: jest.fn()
  }
  const { server, socket } = await createSocket()
  socket.addHeartbeat(cb.any, 50)
  socket.addHeartbeat(cb.in, 50, 'incoming')
  socket.addHeartbeat(cb.out, 50, 'outgoing')

  expect(cb.any).not.toBeCalled()
  await sleep(60)
  // ~60 ms incoming
  // ~60 ms outgoing
  // All callbacks should be triggered
  expect(cb.any).toBeCalledWith(socket)
  expect(cb.any).toBeCalledTimes(1)
  expect(cb.in).toBeCalledTimes(1)
  expect(cb.out).toBeCalledTimes(1)
  for (const _ of new Array(3)) {
    // Reset intervals for 'incoming' and undefined
    server.send({ t: 'test.incoming' })
    await sleep(20)
  }
  // ~20 ms incoming
  // ~120 ms outgoing
  expect(cb.any).toBeCalledTimes(1)
  expect(cb.in).toBeCalledTimes(1)
  expect(cb.out).toBeCalledTimes(2) // Outgoing interval triggered twice
  // Reset intervals for 'outgoing' and undefined
  socket.send('test.outgoing')
  await sleep(40)
  // ~60 ms incoming
  // ~40 ms outgoing
  expect(cb.any).toBeCalledTimes(1)
  expect(cb.in).toBeCalledTimes(2)
  expect(cb.out).toBeCalledTimes(2)

  WS.clean()
})

test('Socket call timeout', async () => {
  const { socket } = await createSocket({ config: { timeout: 5 } })
  await expect(socket.call('test.timeout')).rejects.toEqual(
    new Error('Request timed out')
  )

  WS.clean()
})

test('Socket call response', async () => {
  const { server, socket } = await createSocket()

  const promise = socket.call('test.request')
  expect(await server.nextMessage).toEqual({
    t: 'test.request',
    i: '1'
  })
  server.send({
    t: 'test.response',
    i: '1',
    s: 's'
  })
  expect(await promise).toEqual(expect.objectContaining({ t: 'test.response' }))

  WS.clean()
})

test('channels connection', async () => {
  const { server, socket } = await createSocket()

  const { leave, promise } = socket.channels.subscribe('test', 1)
  expect(await server.nextMessage).toEqual({
    t: 'channel.subscribe',
    i: '1',
    p: {
      channel_type: 'test',
      pk: 1
    }
  })
  server.send({
    t: 'channel.subscribed',
    i: '1',
    p: {
      channel_type: 'test',
      channel_name: 'test_1',
      pk: 1,
      app_state: []
    },
    s: 's'
  })
  await promise
  // Now leave (uses .send(), so does not listen for server response)
  leave(0)
  await sleep() // nextTick
  expect(await server.nextMessage).toEqual({
    t: 'channel.leave',
    p: {
      channel_type: 'test',
      pk: 1
    }
  })

  WS.clean()
})

test('before app_state event', async () => {
  const handler = jest.fn()
  const { server } = await createSocket({ beforeAppStateHandler: handler })

  server.send({
    t: 'channel.subscribed',
    i: '1',
    p: {
      channel_type: 'test',
      channel_name: 'test_1',
      pk: 1,
      app_state: [{ t: 'content', p: {} }]
    },
    s: 's'
  })
  expect(handler).toBeCalledWith({ channelType: 'test', pk: 1 })
  WS.clean()
})
