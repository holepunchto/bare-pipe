/* global Bare */
const test = require('brittle')
const os = require('bare-os')
const Pipe = require('.')

const isWindows = Bare.platform === 'win32'

test('stdout', { skip: isWindows }, (t) => {
  t.plan(1)

  const stdout = new Pipe(1)
  stdout
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('stderr', { skip: isWindows }, (t) => {
  t.plan(1)

  const stdout = new Pipe(2)
  stdout
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('named pipe', (t) => {
  t.plan(1)

  const stdout = new Pipe(name())
  stdout
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('path missing', async (t) => {
  t.plan(1)

  const pipe = new Pipe('does/not/exist')
  pipe
    .on('error', (err) => t.ok(err))
})

test('server', async (t) => {
  t.plan(2)

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
  client.end('hello pipe')

  await lc

  server.close()
})

function name () {
  const name = 'bare-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return os.platform() === 'win32'
    ? '\\\\.\\pipe\\' + name
    : '/tmp/' + name + '.sock'
}
