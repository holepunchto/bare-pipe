const test = require('brittle')
const Pipe = require('.')

test('stdout', (t) => {
  t.plan(1)

  const stdout = new Pipe()
  stdout
    .open(1)
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('stderr', (t) => {
  t.plan(1)

  const stdout = new Pipe()
  stdout
    .open(2)
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('named pipe', (t) => {
  t.plan(1)

  const stdout = new Pipe()
  stdout
    .connect(name())
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('server', async (t) => {
  const n = name()

  const lc = t.test('lifecycle')
  lc.plan(1)

  const server = new Pipe()
  server
    .on('connection', (pipe) => {
      pipe
        .on('data', (data) => lc.alike(data, Buffer.from('hello pipe')))
        .end()
    })
    .bind(n)

  const client = new Pipe()
  client
    .connect(n)
    .end('hello pipe')

  await lc

  server.destroy()
})

function name () {
  const name = 'bare-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\' + name
    : '/tmp/' + name + '.sock'
}
