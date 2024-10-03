/* global Bare */
const test = require('brittle')
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

test('pipe', async (t) => {
  t.plan(1)

  const fds = Pipe.pipe()

  const read = new Pipe(fds[0])

  read.on('data', (data) => t.alike(data, Buffer.from('hello pipe')))

  const write = new Pipe(fds[1])

  write.end('hello pipe')
})

function name () {
  const name = 'bare-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return isWindows
    ? '\\\\.\\pipe\\' + name
    : '/tmp/' + name + '.sock'
}
