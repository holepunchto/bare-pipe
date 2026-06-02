const test = require('brittle')
const tcp = require('bare-tcp')
const Pipe = require('.')

const isWindows = Bare.platform === 'win32'

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

test('immediate destroy', async (t) => {
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

test('pipe', async (t) => {
  t.plan(1)

  const fds = Pipe.pipe()

  const read = new Pipe(fds[0])

  read.on('data', (data) => t.alike(data, Buffer.from('hello pipe')))

  const write = new Pipe(fds[1])

  write.end('hello pipe')
})

test('ipc, data only', { skip: isWindows }, async (t) => {
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

test('ipc, pipe handle pass', { skip: isWindows }, async (t) => {
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

  await new Promise((resolve) => server.on('listening', resolve))

  const { port } = server.address()

  const [a, b] = tcp.socketpair()

  const left = new Pipe(a, { ipc: true })
  const right = new Pipe(b, { ipc: true })

  right
    .on('handle', (type) => {
      t.is(type, Pipe.constants.handle.TCP)

      const received = new tcp.Socket()
      right.accept(received)

      received
        .on('data', (data) => {
          t.alike(data, Buffer.from('ping'))
          received.destroy()
          left.destroy()
          right.destroy()
          server.close()
        })
        .write('ping')
    })
    .resume()

  const peer = tcp.createConnection(port)
  peer.on('connect', () => {
    left.write(Buffer.from('here'), peer, () => {
      t.pass('handle sent')
      peer.destroy()
    })
  })
})

function name() {
  const name =
    'bare-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return isWindows ? '\\\\.\\pipe\\' + name : '/tmp/' + name + '.sock'
}
