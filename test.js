const test = require('brittle')
const fs = require('bare-fs')
const tcp = require('bare-tcp')
const Pipe = require('.')

const isWindows = Bare.platform === 'win32'
const ipcHandle = Symbol.for('bare.ipc.handle')

test('server + client', async (t) => {
  t.plan(2)

  const n = name()

  const lc = t.test('lifecycle')
  lc.plan(6)

  const server = Pipe.createServer()
  server
    .on('close', () => t.pass('server closed'))
    .on('connection', (pipe) => {
      pipe
        .on('close', () => lc.pass('server socket closed'))
        .on('data', (data) => lc.alike(data, Buffer.from('hello server')))
        .on('end', () => lc.pass('server ended'))
        .end('hello client')
    })
    .listen(n)

  const client = new Pipe(n)
  client
    .on('close', () => lc.pass('client socket closed'))
    .on('data', (data) => lc.alike(data, Buffer.from('hello client')))
    .on('end', () => lc.pass('client ended'))
    .end('hello server')

  await lc

  server.close()
})

test('server + client, only server writes', async (t) => {
  t.plan(2)

  const n = name()

  const lc = t.test('lifecycle')
  lc.plan(5)

  const server = Pipe.createServer()
  server
    .on('close', () => t.pass('server closed'))
    .on('connection', (pipe) => {
      pipe
        .on('close', () => lc.pass('server socket closed'))
        .on('data', (data) => lc.alike(data, Buffer.from('hello server')))
        .on('end', () => lc.pass('server ended'))
        .end('hello client')
    })
    .listen(n)

  const client = new Pipe(n)
  client
    .on('close', () => lc.pass('client socket closed'))
    .on('data', (data) => lc.alike(data, Buffer.from('hello client')))
    .on('end', () => {
      lc.pass('client ended')
      client.end()
    })

  await lc

  server.close()
})

test('server + client, only client writes', async (t) => {
  t.plan(2)

  const n = name()

  const lc = t.test('lifecycle')
  lc.plan(5)

  const server = Pipe.createServer()
  server
    .on('close', () => t.pass('server closed'))
    .on('connection', (pipe) => {
      pipe
        .on('close', () => lc.pass('server socket closed'))
        .on('data', (data) => lc.alike(data, Buffer.from('hello server')))
        .on('end', () => {
          lc.pass('server ended')
          pipe.end()
        })
    })
    .listen(n)

  const client = new Pipe(n)
  client
    .on('close', () => lc.pass('client socket closed'))
    .on('end', () => lc.pass('client ended'))
    .end('hello server')

  await lc

  server.close()
})

test('socket, read buffer size must be an integer', (t) => {
  t.plan(4)

  t.exception(() => new Pipe({ readBufferSize: 'abc' }), /INVALID_ARGUMENT/)
  t.exception(() => new Pipe({ readBufferSize: 0 }), /INVALID_ARGUMENT/)
  t.exception(() => new Pipe({ readBufferSize: 1.5 }), /INVALID_ARGUMENT/)
  t.exception(() => Pipe.createServer({ readBufferSize: null }), /INVALID_ARGUMENT/)
})

test('socket, read buffer size bounds the chunk size', async (t) => {
  t.plan(2)

  const n = name()
  const payload = Buffer.alloc(64 * 1024, 3)
  const readBufferSize = 1024

  const server = Pipe.createServer({ allowHalfOpen: false }, (pipe) => pipe.end(payload))
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n, { readBufferSize, allowHalfOpen: false })

  const chunks = []
  client.on('data', (data) => chunks.push(data))

  await new Promise((resolve) => client.on('close', resolve))

  t.alike(Buffer.concat(chunks), payload, 'received the whole payload')
  t.ok(
    chunks.every((chunk) => chunk.byteLength <= readBufferSize),
    'no chunk exceeded the read buffer size'
  )

  await new Promise((resolve) => server.close(resolve))
})

test('socket, ipc is coerced to a boolean', async (t) => {
  t.plan(2)

  const socket = new Pipe({ ipc: 1 })

  t.is(socket.readyState, 'opening', 'constructed with a truthy ipc option')

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))

  const server = Pipe.createServer({ ipc: 0 })

  t.absent(server.listening, 'constructed with a falsy ipc option')

  await new Promise((resolve) => server.close(resolve))
})

test('socket, readyState and pending before connecting', async (t) => {
  t.plan(3)

  const socket = new Pipe()

  t.is(socket.readyState, 'opening', 'opening while unconnected')
  t.ok(socket.pending, 'pending while unconnected')
  t.absent(socket.connecting, 'not connecting until asked to')

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, readyState and pending while connected', async (t) => {
  t.plan(4)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end())
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)

  t.ok(client.connecting, 'connecting once asked to')
  t.ok(client.pending, 'pending until connected')

  await new Promise((resolve) => client.on('connect', resolve))

  t.is(client.readyState, 'open', 'open once connected')
  t.absent(client.pending, 'not pending once connected')

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, connecting is false after failed connect', async (t) => {
  const socket = new Pipe()
  socket.on('error', () => {})
  socket.connect(name())

  await new Promise((resolve) => socket.on('close', resolve))

  t.absent(socket.connecting, 'not connecting after failed connect')
})

test('socket, connect with callback', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end())
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe()
  client.connect(n, () => t.pass('connected'))

  await new Promise((resolve) => client.on('connect', resolve))

  t.absent(client.connecting, 'not connecting once connected')

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, connect with options', async (t) => {
  t.plan(1)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end('hello client'))
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe()
  client.connect({ path: n })
  client.on('data', (data) => t.alike(data, Buffer.from('hello client')))

  await new Promise((resolve) => client.on('end', resolve))

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, connect while already connecting', async (t) => {
  t.plan(1)

  const socket = new Pipe(name())
  socket.on('error', () => {})

  t.exception(() => socket.connect(name()), /PIPE_ALREADY_CONNECTED/)

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, connect while already connected', async (t) => {
  t.plan(1)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end())
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)

  await new Promise((resolve) => client.on('connect', resolve))

  t.exception(() => client.connect(name()), /PIPE_ALREADY_CONNECTED/)

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, connect with a path that is too long', { skip: isWindows }, async (t) => {
  t.plan(2)

  const socket = new Pipe('/tmp/' + 'a'.repeat(512) + '.sock')
  socket.on('error', (err) => {
    t.is(err.code, 'EINVAL')
    t.absent(socket.connecting, 'not connecting after a rejected path')
  })

  await new Promise((resolve) => socket.on('close', resolve))
})

test(
  'socket, connect with a path that is too long, without an eager open',
  { skip: isWindows },
  async (t) => {
    t.plan(1)

    const socket = new Pipe('/tmp/' + 'a'.repeat(512) + '.sock', { eagerOpen: false })
    socket.on('error', (err) => t.is(err.code, 'EINVAL'))

    await new Promise((resolve) => socket.on('close', resolve))
  }
)

test('socket, connect with a path longer than the maximum', async (t) => {
  t.plan(2)

  const socket = new Pipe()

  t.exception(() => socket.connect('a'.repeat(Pipe.constants.path.MAX_LENGTH + 1)), /INVALID_PATH/)
  t.exception(() => socket.connect(42), /INVALID_PATH/)

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, connect with a path measured in bytes', async (t) => {
  t.plan(1)

  // Every character takes three bytes, so the byte length is over the limit
  // while the character length is well under it.
  const path = '\u3042'.repeat(Math.floor(Pipe.constants.path.MAX_LENGTH / 3) + 1)

  const socket = new Pipe()

  t.exception(() => socket.connect(path), /INVALID_PATH/)

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, connect after a rejected path', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end())
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe()

  t.exception(() => client.connect(42), /INVALID_PATH/)

  client.connect(n)

  await new Promise((resolve) => client.on('connect', resolve))

  t.absent(client.pending, 'connecting still works after a rejected path')

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, connect failure without an eager open', async (t) => {
  t.plan(1)

  const socket = new Pipe(name(), { eagerOpen: false })
  socket.on('error', (err) => t.ok(err.code, 'connect failed with ' + err.code))

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, connect after a failed connect', async (t) => {
  t.plan(1)

  const socket = new Pipe(name())
  socket.on('error', () => {})

  await new Promise((resolve) => socket.on('close', resolve))

  t.exception(() => socket.connect(name()), /PIPE_IS_CLOSED/)
})

test('socket, connect after being destroyed', async (t) => {
  t.plan(2)

  const socket = new Pipe()
  socket.on('error', () => {})
  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))

  t.exception(() => socket.connect(name()), /PIPE_IS_CLOSED/)
  t.exception(() => socket.open(Pipe.pipe()[0]), /PIPE_IS_CLOSED/)
})

test('socket, connect after being destroyed while connected', async (t) => {
  t.plan(1)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end())
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)

  await new Promise((resolve) => client.on('connect', resolve))

  client.destroy()

  await new Promise((resolve) => client.on('close', resolve))

  // Being closed takes precedence over being connected, otherwise the error is
  // misleading.
  t.exception(() => client.connect(n), /PIPE_IS_CLOSED/)

  await new Promise((resolve) => server.close(resolve))
})

test('socket, no connect event once destroyed', async (t) => {
  t.plan(1)

  const [readFd, writeFd] = Pipe.pipe()

  const read = new Pipe(readFd)
  read.on('connect', () => t.fail('connect emitted on a destroyed socket'))
  read.destroy()

  const write = new Pipe(writeFd)
  write.destroy()

  await new Promise((resolve) => read.on('close', resolve))
  await new Promise((resolve) => setTimeout(resolve, 50))

  t.pass('no connect event on a destroyed socket')
})

test('socket, destroy with a connect in flight', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end())
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)
  client.on('connect', () => t.fail('connect emitted after destroy'))
  client.on('error', () => {})

  // Destroy before the connect has had a chance to complete.
  client.destroy()

  await new Promise((resolve) => client.on('close', resolve))

  t.pass('closed cleanly with a connect in flight')
  t.absent(client.connecting, 'not connecting')

  await new Promise((resolve) => server.close(resolve))
})

test('socket, open with callback and options', async (t) => {
  t.plan(3)

  const [readFd, writeFd] = Pipe.pipe()

  const read = new Pipe()
  read.open(readFd, () => t.pass('read end opened'))

  const write = new Pipe()
  write.open({ fd: writeFd }, () => {
    t.pass('write end opened')
    write.end('hello pipe')
  })

  read.on('data', (data) => t.alike(data, Buffer.from('hello pipe')))

  await new Promise((resolve) => read.on('end', resolve))

  read.destroy()
  write.destroy()
})

test('socket, open with an invalid fd', async (t) => {
  t.plan(1)

  const socket = new Pipe(1 << 24)
  socket.on('error', (err) => t.is(err.code, 'EBADF'))

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, open with an invalid fd type', async (t) => {
  t.plan(4)

  const socket = new Pipe()

  t.exception(() => socket.open('3'), /INVALID_FD/)
  t.exception(() => socket.open({ fd: '3' }), /INVALID_FD/)
  t.exception(() => socket.open(-1), /INVALID_FD/)
  t.exception(() => socket.open(1.5), /INVALID_FD/)

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, open with an invalid fd, without an eager open', async (t) => {
  t.plan(1)

  const socket = new Pipe(1 << 24, { eagerOpen: false })
  socket.on('error', (err) => t.is(err.code, 'EBADF'))

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, open with an invalid fd after the socket has opened', async (t) => {
  t.plan(1)

  const socket = new Pipe()
  socket.on('error', (err) => t.is(err.code, 'EBADF'))

  // Give the eager open a chance to settle before opening the fd, so that the
  // failure has to be reported against an already opened socket.
  await new Promise((resolve) => setTimeout(resolve, 0))

  socket.open(1 << 24)

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, open after the eager open has settled', async (t) => {
  t.plan(2)

  const [readFd, writeFd] = Pipe.pipe()

  const read = new Pipe()
  const write = new Pipe()

  // Let the eager open settle so that both streams are already waiting on it.
  await new Promise((resolve) => setTimeout(resolve, 0))

  read.open(readFd)
  write.open(writeFd)

  write.end('hello pipe')

  const received = await Promise.race([
    new Promise((resolve) => read.on('data', resolve)),
    new Promise((resolve) => setTimeout(() => resolve(null), 500))
  ])

  t.alike(received, Buffer.from('hello pipe'), 'data flowed after opening')
  t.absent(read.pending, 'no longer pending')

  read.destroy()
  write.destroy()

  await new Promise((resolve) => read.on('close', resolve))
})

test('socket, write with callback', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer((pipe) => {
    pipe.on('data', (data) => {
      t.alike(data, Buffer.from('hello server'))
      pipe.end()
    })
  })
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)
  client.write(Buffer.from('hello server'), () => t.pass('write flushed'))

  await new Promise((resolve) => client.on('end', resolve))

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, write with encoding', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer((pipe) => {
    const chunks = []

    pipe
      .on('data', (data) => chunks.push(data))
      .on('end', () => {
        t.alike(Buffer.concat(chunks), Buffer.from('hello serverhello again'))
        pipe.end()
      })
  })
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)
  client.write(Buffer.from('hello server').toString('hex'), 'hex', () => t.pass('write flushed'))
  client.write(Buffer.from('hello again').toString('base64'), 'base64')
  client.end()

  await new Promise((resolve) => client.on('end', resolve))

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('socket, write with a handle on a non-ipc pipe', async (t) => {
  t.plan(1)

  const [readFd, writeFd] = Pipe.pipe()

  const read = new Pipe(readFd)
  const write = new Pipe(writeFd)
  const target = new Pipe()

  write.on('error', (err) => {
    t.is(err.code, 'EINVAL')

    read.destroy()
    target.destroy()
  })

  write.write(Buffer.from('here'), target)

  await new Promise((resolve) => write.on('close', resolve))
})

test('socket, write with an invalid handle', async (t) => {
  t.plan(2)

  const socket = new Pipe()

  t.exception(() => socket.write(Buffer.from('here'), {}), /INVALID_IPC_TARGET/)
  t.exception(() => socket.write(Buffer.from('here'), { [ipcHandle]: 42 }), /INVALID_IPC_TARGET/)

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, backpressure', async (t) => {
  t.plan(1)

  const n = name()
  const payload = Buffer.alloc(1024 * 1024, 1)

  const server = Pipe.createServer({ allowHalfOpen: false }, (pipe) => pipe.end(payload))
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n, { readBufferSize: 65536, allowHalfOpen: false })

  const chunks = []
  client.on('data', (data) => chunks.push(data))

  // Stop consuming for a while so that the read buffer fills up and the
  // underlying handle has to be paused.
  client.pause()

  await new Promise((resolve) => setTimeout(resolve, 100))

  client.resume()

  await new Promise((resolve) => client.on('close', resolve))

  t.alike(Buffer.concat(chunks), payload, 'received the whole payload')

  await new Promise((resolve) => server.close(resolve))
})

test('socket, allow half open false', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end('hello client'))
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n, { allowHalfOpen: false })
  client
    .on('end', () => t.pass('client ended'))
    .on('finish', () => t.pass('client finished without being ended'))
    .resume()

  await new Promise((resolve) => client.on('close', resolve))

  await new Promise((resolve) => server.close(resolve))
})

test('socket, open error is forwarded as a stream error', { skip: isWindows }, async (t) => {
  t.plan(1)

  // A directory can't be watched by the event loop and so can't back a pipe.
  const fd = fs.openSync('/tmp', 'r')

  const socket = new Pipe(fd)
  socket.on('error', (err) => t.is(err.code, 'EINVAL'))
  socket.resume()

  await new Promise((resolve) => socket.on('close', resolve))

  fs.closeSync(fd)
})

test('socket, accept a target without the ipc handle protocol', async (t) => {
  t.plan(1)

  const socket = new Pipe()

  t.exception(() => socket.accept({}), /INVALID_IPC_TARGET/)

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, accept a target with a forged handle', async (t) => {
  t.plan(2)

  const socket = new Pipe()

  t.exception(() => socket.accept({ [ipcHandle]: 42 }), /INVALID_IPC_TARGET/)
  t.exception(() => socket.accept({ [ipcHandle]: { byteLength: 4096 } }), /INVALID_IPC_TARGET/)

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, ref and unref', async (t) => {
  t.plan(2)

  const socket = new Pipe()

  t.is(socket.unref(), socket, 'unref is chainable')
  t.is(socket.ref(), socket, 'ref is chainable')

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))
})

test('socket, ref and unref after destroy', async (t) => {
  const socket = new Pipe()

  socket.destroy()

  await new Promise((resolve) => socket.on('close', resolve))

  // Redundant during teardown rather than an error, matching the server.
  t.is(socket.ref(), socket)
  t.is(socket.unref(), socket)
})

test('socket, immediate destroy', async (t) => {
  t.plan(2)

  const n = name()

  const lc = t.test('lifecycle')
  lc.plan(3)

  const server = Pipe.createServer()
  server
    .on('close', () => t.pass('server closed'))
    .on('connection', (pipe) => {
      pipe
        .on('close', () => lc.pass('server socket closed'))
        .on('end', () => {
          lc.pass('server ended')
          pipe.end()
        })
    })
    .listen(n)

  const client = new Pipe(n)
  client
    .on('close', () => lc.pass('client socket closed'))
    .on('end', () => lc.pass('client ended'))
    .destroy()

  await lc

  server.close()
})

test('server, connection listener as the only argument', async (t) => {
  t.plan(2)

  const n = name()

  const server = new Pipe.Server((pipe) => {
    t.pass('server got a connection')
    pipe.end()
  })
  server.listen(n, () => t.pass('listening'))

  const client = new Pipe(n)

  await new Promise((resolve) => client.on('end', resolve))

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('server, pause on connect', async (t) => {
  t.plan(1)

  const n = name()

  const server = Pipe.createServer({ pauseOnConnect: true }, (pipe) => {
    pipe.on('data', (data) => {
      t.alike(data, Buffer.from('hello server'))
      pipe.end()
    })
  })
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)
  client.end('hello server')

  await new Promise((resolve) => client.on('end', resolve))

  client.destroy()

  await new Promise((resolve) => server.close(resolve))
})

test('server, closing', async (t) => {
  t.plan(3)

  const server = Pipe.createServer()

  t.absent(server.closing, 'not closing before listening')

  server.listen(name())

  await waitForListening(server)

  server.close()

  t.ok(server.closing, 'closing as soon as close is called')

  await new Promise((resolve) => server.on('close', resolve))

  t.ok(server.closing, 'still closing once closed')
})

test('server, listening is false after close', async (t) => {
  t.plan(3)

  const server = Pipe.createServer()
  server.listen(name())

  await waitForListening(server)

  t.ok(server.listening, 'listening while bound')

  server.close(() => {
    t.absent(server.listening, 'not listening after close')
    t.is(server.address(), null, 'no address after close')
  })
})

test('server, address while listening', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer()
  server.listen(n)

  await waitForListening(server)

  t.ok(server.listening, 'listening')
  t.is(server.address(), n, 'address is the bound path')

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen with backlog and callback', async (t) => {
  t.plan(1)

  const server = Pipe.createServer()
  server.listen(name(), 128, () => t.pass('listening'))

  await waitForListening(server)

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen with options', async (t) => {
  t.plan(2)

  const n = name()

  const server = Pipe.createServer()
  server.listen({ path: n, backlog: 128 })

  await waitForListening(server)

  t.is(server.address(), n, 'address is the bound path')

  const other = name()

  const withoutBacklog = Pipe.createServer()
  withoutBacklog.listen({ path: other })

  await waitForListening(withoutBacklog)

  t.is(withoutBacklog.address(), other, 'address is the bound path')

  await new Promise((resolve) => withoutBacklog.close(resolve))
  await new Promise((resolve) => server.close(resolve))
})

test('server, listen with an invalid backlog', async (t) => {
  t.plan(3)

  const server = Pipe.createServer()

  t.exception(() => server.listen(name(), 'abc'), /INVALID_ARGUMENT/)
  t.exception(() => server.listen({ path: name(), backlog: 'abc' }), /INVALID_ARGUMENT/)

  // A rejected argument must not leave the server wedged.
  const n = name()
  server.listen(n)

  await waitForListening(server)

  t.is(server.address(), n, 'listening still works after a rejected backlog')

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen with a path longer than the maximum', async (t) => {
  t.plan(2)

  const server = Pipe.createServer()

  t.exception(() => server.listen('a'.repeat(Pipe.constants.path.MAX_LENGTH + 1)), /INVALID_PATH/)
  t.exception(() => server.listen({ path: 42 }), /INVALID_PATH/)

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen while already listening', async (t) => {
  t.plan(1)

  const server = Pipe.createServer()
  server.listen(name())

  t.exception(() => server.listen(name()), /SERVER_ALREADY_LISTENING/)

  await new Promise((resolve) => server.close(resolve))
})

test('server, listen after close', async (t) => {
  t.plan(1)

  const server = Pipe.createServer()

  await new Promise((resolve) => server.close(resolve))

  t.exception(() => server.listen(name()), /SERVER_IS_CLOSED/)
})

test('server, listen while closing', async (t) => {
  t.plan(1)

  const server = Pipe.createServer()
  server.listen(name())

  await waitForListening(server)

  server.close()

  t.exception(() => server.listen(name()), /SERVER_IS_CLOSED/)

  await new Promise((resolve) => server.on('close', resolve))
})

test('server, listen on the same path after closing', async (t) => {
  t.plan(2)

  const n = name()

  const first = Pipe.createServer()
  first.listen(n)

  await waitForListening(first)
  await new Promise((resolve) => first.close(resolve))

  // The path is released on close, so it can be bound again.
  const second = Pipe.createServer()
  second.listen(n)

  await waitForListening(second)

  t.ok(second.listening, 'bound the released path')
  t.is(second.address(), n, 'address is the released path')

  await new Promise((resolve) => second.close(resolve))
})

test('server, no listening event once closed', async (t) => {
  t.plan(1)

  const server = Pipe.createServer()
  server.on('listening', () => t.fail('listening emitted on a closing server'))
  server.listen(name())
  server.close()

  await new Promise((resolve) => server.on('close', resolve))
  await new Promise((resolve) => setTimeout(resolve, 50))

  t.pass('no listening event on a closed server')
})

test('server, bind error', async (t) => {
  t.plan(3)

  const n = name()

  const first = Pipe.createServer()
  first.listen(n)

  await waitForListening(first)

  const second = Pipe.createServer()
  second.on('error', (err) => {
    t.is(err.code, 'EADDRINUSE')
    t.absent(second.listening, 'not listening after a failed bind')
    t.is(second.address(), null, 'no address after a failed bind')
  })
  second.listen(n)

  await new Promise((resolve) => first.close(resolve))
})

test('server, listen again after a failed bind', async (t) => {
  t.plan(2)

  const n = name()

  const first = Pipe.createServer()
  first.listen(n)

  await waitForListening(first)

  const second = Pipe.createServer()
  second.listen(n)

  const err = await new Promise((resolve) => second.on('error', resolve))

  t.is(err.code, 'EADDRINUSE', 'bind failed')

  const other = name()
  second.listen(other)

  await waitForListening(second)

  t.is(second.address(), other, 'bound to another path after the failure')

  await new Promise((resolve) => second.close(resolve))
  await new Promise((resolve) => first.close(resolve))
})

test('server, close without listening', async (t) => {
  t.plan(2)

  const server = Pipe.createServer()

  await new Promise((resolve) => server.close(resolve))

  t.pass('closed without ever listening')

  await new Promise((resolve) => server.close(resolve))

  t.pass('closed again')
})

test('server, close after closing', async (t) => {
  t.plan(3)

  const server = Pipe.createServer()
  server.listen(name())

  await waitForListening(server)
  await new Promise((resolve) => server.close(resolve))

  t.is(server.close(), server, 'close is chainable once closed')

  await new Promise((resolve) => server.close(resolve))

  t.pass('close called back again once closed')
  t.is(server.listenerCount('close'), 0, 'no close listeners left behind')
})

test('server, close callbacks while closing', async (t) => {
  t.plan(2)

  const server = Pipe.createServer()
  server.listen(name())

  await waitForListening(server)

  let closes = 0
  server.on('close', () => closes++)

  let callbacks = 0
  server.close(() => callbacks++)
  server.close(() => callbacks++)
  server.close(() => callbacks++)

  await new Promise((resolve) => setTimeout(resolve, 50))

  t.is(callbacks, 3, 'every close callback ran')
  t.is(closes, 1, 'closed once')
})

test('server, close after a failed bind', async (t) => {
  t.plan(2)

  const n = name()

  const first = Pipe.createServer()
  first.listen(n)

  await waitForListening(first)

  const events = []

  const second = Pipe.createServer()
  second.on('error', (err) => events.push(err.code))
  second.on('close', () => events.push('close'))
  second.listen(n)
  second.close(() => events.push('callback'))

  await new Promise((resolve) => setTimeout(resolve, 50))

  t.alike(events, ['EADDRINUSE', 'close', 'callback'], 'reported the error before closing')
  t.absent(second.listening, 'not listening')

  await new Promise((resolve) => first.close(resolve))
})

test('server, close releases the path right away', async (t) => {
  t.plan(4)

  const n = name()

  let connections = 0

  const server = Pipe.createServer((pipe) => {
    connections++

    // Close while this connection is still open, then try to connect again.
    server.close()

    t.absent(server.listening, 'not listening as soon as close is called')
    t.is(server.address(), null, 'no address as soon as close is called')

    const late = new Pipe(n)
    late.on('error', () => {
      t.pass('a later connection is refused')
      pipe.destroy()
    })
  })
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)
  client.on('error', () => {})

  await new Promise((resolve) => server.on('close', resolve))

  t.is(connections, 1, 'only the connection made while listening was accepted')

  client.destroy()
})

test('server, close with a connect in flight', async (t) => {
  t.plan(1)

  const n = name()

  const server = Pipe.createServer(() => t.fail('connection emitted after close'))
  server.listen(n)

  await waitForListening(server)

  const client = new Pipe(n)
  client.on('error', () => {})

  // Close before the pending connect has been accepted.
  server.close()

  await new Promise((resolve) => server.on('close', resolve))

  t.pass('closed cleanly with a connect in flight')

  client.destroy()
})

test('server, ref and unref', async (t) => {
  t.plan(3)

  const server = Pipe.createServer()

  t.is(server.unref(), server, 'unref is chainable without a handle')

  server.listen(name(), () => t.pass('listening'))

  t.is(server.ref(), server, 'ref is chainable with a handle')

  server.unref()
  server.ref()

  await waitForListening(server)

  await new Promise((resolve) => server.close(resolve))
})

test('createConnection, arguments', async (t) => {
  t.plan(5)

  const n = name()

  const server = Pipe.createServer((pipe) => pipe.end('hello client'))
  server.listen(n)

  await waitForListening(server)

  const a = Pipe.createConnection(n)
  const b = Pipe.createConnection(n, () => t.pass('connected with callback'))
  const c = Pipe.createConnection({ path: n })
  const d = Pipe.createConnection(n, { allowHalfOpen: false })

  for (const socket of [a, b, c, d]) {
    const chunks = []

    socket.on('data', (data) => chunks.push(data))

    await new Promise((resolve) => socket.on('end', resolve))

    t.alike(Buffer.concat(chunks), Buffer.from('hello client'))

    socket.destroy()
  }

  await new Promise((resolve) => server.close(resolve))
})

test('pipe, data flow between the ends', (t) => {
  t.plan(1)

  const fds = Pipe.pipe()

  const read = new Pipe(fds[0])

  read.on('data', (data) => t.alike(data, Buffer.from('hello pipe')))

  const write = new Pipe(fds[1])

  write.end('hello pipe')
})

test('pipe, readyState of both ends', async (t) => {
  t.plan(3)

  const [readFd, writeFd] = Pipe.pipe()

  const read = new Pipe(readFd)
  const write = new Pipe(writeFd)

  t.is(read.readyState, 'readOnly', 'read end is read only')
  t.is(write.readyState, 'writeOnly', 'write end is write only')

  read.on('data', (data) => t.alike(data, Buffer.from('hello pipe')))

  write.end('hello pipe')

  await new Promise((resolve) => read.on('end', resolve))

  read.destroy()
  write.destroy()
})

test('ipc, data only', { skip: isWindows }, (t) => {
  t.plan(1)

  const [a, b] = tcp.socketpair()

  const left = new Pipe(a, { ipc: true })
  const right = new Pipe(b, { ipc: true })

  right.on('data', (data) => {
    t.alike(data, Buffer.from('hello ipc'))
    left.destroy()
    right.destroy()
  })

  left.write(Buffer.from('hello ipc'))
})

test('ipc, pipe handle pass', { skip: isWindows }, (t) => {
  t.plan(3)

  const echo = name()

  const server = Pipe.createServer()
  server.on('connection', (peer) => peer.pipe(peer)).listen(echo)

  const [a, b] = tcp.socketpair()

  const left = new Pipe(a, { ipc: true })
  const right = new Pipe(b, { ipc: true })

  right
    .on('handle', (type) => {
      t.is(type, Pipe.constants.handle.NAMED_PIPE)

      const received = new Pipe()
      right.accept(received)

      received.on('data', (data) => {
        t.alike(data, Buffer.from('ping'))
        received.destroy()
        left.destroy()
        right.destroy()
        server.close()
      })
      received.write('ping')
    })
    .resume()

  const peer = new Pipe(echo)
  peer.on('connect', () => {
    left.write(Buffer.from('here'), peer, () => {
      t.pass('handle sent')
      peer.destroy()
    })
  })
})

test('ipc, tcp handle pass', { skip: isWindows }, async (t) => {
  t.plan(3)

  const server = tcp.createServer()
  server.on('connection', (sock) => sock.pipe(sock)).listen()

  await waitForListening(server)

  const { port } = server.address()

  const [a, b] = tcp.socketpair()

  const left = new Pipe(a, { ipc: true })
  const right = new Pipe(b, { ipc: true })

  const peer = tcp.createConnection(port)

  right
    .on('handle', (type) => {
      t.is(type, Pipe.constants.handle.TCP)

      const received = new tcp.Socket()
      right.accept(received)

      received
        .on('data', (data) => {
          t.alike(data, Buffer.from('ping'))
          received.destroy()
          peer.destroy()
          left.destroy()
          right.destroy()
          server.close()
        })
        .write('ping')
    })
    .resume()

  peer.on('connect', () => {
    left.write(Buffer.from('here'), peer, () => t.pass('handle sent'))
  })
})

test('ipc, multiple pending handles drain in order', { skip: isWindows }, async (t) => {
  t.plan(6)

  const echoA = name()
  const echoB = name()

  const serverA = Pipe.createServer()
  serverA.on('connection', (peer) => peer.pipe(peer)).listen(echoA)

  const serverB = Pipe.createServer()
  serverB.on('connection', (peer) => peer.pipe(peer)).listen(echoB)

  const [a, b] = tcp.socketpair()

  const left = new Pipe(a, { ipc: true })
  const right = new Pipe(b, { ipc: true })

  const received = []

  right
    .on('handle', (type) => {
      const target = type === Pipe.constants.handle.NAMED_PIPE ? new Pipe() : new tcp.Socket()
      right.accept(target)
      received.push({ type, target })

      if (received.length === 3) {
        t.is(received[0].type, Pipe.constants.handle.NAMED_PIPE, 'first is pipe')
        t.is(received[1].type, Pipe.constants.handle.TCP, 'second is tcp')
        t.is(received[2].type, Pipe.constants.handle.NAMED_PIPE, 'third is pipe')

        for (const { target } of received) target.destroy()
        peerA.destroy()
        peerT.destroy()
        peerB.destroy()
        left.destroy()
        right.destroy()
        serverA.close()
        serverB.close()
        server.close()
      }
    })
    .resume()

  const server = tcp.createServer()
  server.on('connection', (sock) => sock.pipe(sock)).listen()
  await waitForListening(server)
  const { port } = server.address()

  const peerA = new Pipe(echoA)
  const peerT = tcp.createConnection(port)
  const peerB = new Pipe(echoB)

  let connected = 0
  const tryWrite = () => {
    if (++connected < 3) return

    left.write(Buffer.from('a'), peerA, () => t.pass('first sent'))
    left.write(Buffer.from('b'), peerT, () => t.pass('second sent'))
    left.write(Buffer.from('c'), peerB, () => t.pass('third sent'))
  }

  peerA.on('connect', tryWrite)
  peerT.on('connect', tryWrite)
  peerB.on('connect', tryWrite)
})

test('ipc, handle and data writes in the same batch', { skip: isWindows }, async (t) => {
  t.plan(2)

  const echo = name()

  const server = Pipe.createServer({ allowHalfOpen: false }, (peer) => peer.pipe(peer))
  server.listen(echo)

  await waitForListening(server)

  const [a, b] = tcp.socketpair()

  const left = new Pipe(a, { ipc: true })
  const right = new Pipe(b, { ipc: true })

  const types = []
  const received = []

  right
    .on('handle', (type) => {
      types.push(type)
      right.accept(new Pipe()).destroy()
    })
    .on('data', (data) => received.push(data))

  const peer = new Pipe(echo)

  await new Promise((resolve) => peer.on('connect', resolve))

  left.write(Buffer.from('one'))
  left.write(Buffer.from('two'), peer)
  left.write(Buffer.from('three'))
  left.end(Buffer.from('four'))

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.alike(types, [Pipe.constants.handle.NAMED_PIPE], 'received a single handle')
  t.alike(Buffer.concat(received), Buffer.from('onetwothreefour'), 'received all data in order')

  peer.destroy()
  left.destroy()
  right.destroy()

  await new Promise((resolve) => server.close(resolve))
})

function waitForListening(server) {
  if (server.listening) return Promise.resolve()

  return waitFor(server, 'listening')
}

function waitFor(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.on(event, done).on('error', done)

    function done(err) {
      emitter.off(event, done).off('error', done)

      err ? reject(err) : resolve()
    }
  })
}

function name() {
  const name =
    'bare-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return isWindows ? '\\\\.\\pipe\\' + name : '/tmp/' + name + '.sock'
}
