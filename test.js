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
  await new Promise((resolve) => server.on('listening', resolve))
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

function name() {
  const name =
    'bare-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return isWindows ? '\\\\.\\pipe\\' + name : '/tmp/' + name + '.sock'
}
