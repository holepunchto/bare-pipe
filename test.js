/* global Bare */
const test = require('brittle')
const Pipe = require('.')

const isWindows = Bare.platform === 'win32'

test('server + client', async (t) => {
  t.plan(3)

  const n = name()

  const lc = t.test('lifecycle')
  lc.plan(1)

  const server = Pipe.createServer()
  server
    .on('close', () => t.pass('server closed'))
    .on('connection', (pipe) => {
      pipe
        .on('data', (data) => lc.alike(data, Buffer.from('hello pipe')))
        .end()
    })
    .listen(n)

  const client = new Pipe(n)
  client
    .on('close', () => t.pass('client closed'))
    .end('hello pipe')

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
