const test = require('brittle')
const Pipe = require('.')

test('stdout', (t) => {
  t.plan(1)

  const stdout = new Pipe(1)

  stdout
    .on('close', () => t.pass('closed'))
    .end('hello from pipe\n')
})

test('stderr', (t) => {
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

function name () {
  const name = 'pear-pipe-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\' + name
    : '/tmp/' + name + '.sock'
}
