const process = require('process')
const path = require('path')
const { spawn } = require('child_process')

const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const NewlineDecoder = require('newline-decoder')
const axios = require('axios')
const DHT = require('hyperdht')
const b4a = require('b4a')
const idEncoding = require('hypercore-id-encoding')
const { ALPHABET: Z32_ALPHABET } = require('z32')

const DEBUG = false

const MAIN_DIR = path.dirname(path.dirname(__filename))
const EXECUTABLE = path.join(MAIN_DIR, 'docker-entrypoint.js')

// To force the process.on('exit') to be called on those exits too
process.prependListener('SIGINT', () => process.exit(1))
process.prependListener('SIGTERM', () => process.exit(1))

test('Instrumented blind relay end to end test', async t => {
  const testnet = await createTestnet()
  const bootstrap = testnet.bootstrap

  // quickFirewall: false is needed for both dht's to help avoid a direct connection
  const serverDht = new DHT(
    { bootstrap, quickFirewall: false }
  )
  const clientDht = new DHT(
    { bootstrap, quickFirewall: false }
  )

  const setupServerProc = spawn('node', [EXECUTABLE], {
    env: {
      ...process.env, // To get the node exec
      BLIND_RELAY_HTTP_PORT: 0,
      BLIND_RELAY_HTTP_HOST: '127.0.0.1',
      _BLIND_RELAY_BOOTSTRAP_PORT: bootstrap[0].port,
      BLIND_RELAY_USE_RAM: 'true'
    }
  })

  // To avoid zombie processes in case there's an error
  // (Removed later if the test exits normally)
  const unexpectedExitHandler = () => {
    setupServerProc.kill('SIGKILL')
  }
  process.on('exit', unexpectedExitHandler)

  let statusCode = null
  setupServerProc.on('close', code => {
    statusCode = code
    process.off('exit', unexpectedExitHandler)
  })

  let pubKey = null

  setupServerProc.stderr.on('data', (data) => {
    console.error(b4a.toString(data))
    t.fail('Failed to setup the blind-relay server')
  })

  const serverReadyMsg = 'Prometheus metrics server is listening at'
  let url = null

  const stdoutDec = new NewlineDecoder('utf-8')
  await new Promise(resolve => {
    setupServerProc.stdout.on('data', (data) => {
      if (DEBUG) console.log(b4a.toString(data))

      for (const line of stdoutDec.push(data)) {
        if (line.includes(serverReadyMsg)) {
          const match = line.match(new RegExp(`${serverReadyMsg} (http://127.0.0.1:[0-9]+)`))
          url = match[1]
          resolve()
        }
        if (line.includes('Relay server listening at public key')) {
          pubKey = line.match(new RegExp(`([${Z32_ALPHABET}]{52})`))[1]
        }
      }
    })
  })

  if (!url || !pubKey) t.fail('Server was not setup, or failed to extract the URL, or failed to extract the pubKey')

  // await new Promise(resolve => setTimeout(resolve, 500)) // TODO: figure out lifetime issue (prom scrape fails without)

  t.is(
    (await axios.get(`${url}/health`)).data,
    'Healthy\n',
    '/health endpoint works'
  )

  {
    const initMetrics = (await axios.get(`${url}/metrics`)).data
    t.is(initMetrics.includes('blind_relay_active_sessions 0'), true, 'sanity check on init state')

    /* t.is(
      initMetrics.includes('blind_relay_opened_connections 0'),
      true,
      'Initially 0 opened connections'
    ) */
  }

  await relayOver(serverDht, clientDht, pubKey)

  {
    const nowMetrics = (await axios.get(`${url}/metrics`)).data
    t.is(nowMetrics.includes('blind_relay_active_sessions 2'), true, 'active sessions tracked') // Note: Not 100% sure this is guaranteed to be true
    /* TODO: ass back these metrics
    t.is(
      nowMetrics.includes('blind_relay_opened_connections 2'),
      true,
      'Now 2 opened connections'
    )

    t.is(
      nowMetrics.includes('blind_relay_paired_connections 2'),
      true,
      'The connections got paired'
    ) */
  }
  setupServerProc.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 5000))
  // Note: we SIGTERM, so exit code won't be 0
  t.not(statusCode, null, 'Exited cleanly within a reasonable time')

  await clientDht.destroy()
  await serverDht.destroy()
  await testnet.destroy()
})

// Copied from blind-relay-blackbox-exporter
async function relayOver (serverDht, clientDht, relayPubKey, sTimeout = 5) {
  relayPubKey = idEncoding.decode(relayPubKey)

  const server = serverDht.createServer({
    holepunch: false, // To ensure it relies only on relaying
    shareLocalAddress: false // To help ensure it relies only on relaying (otherwise it can connect directly over LAN, without even trying to holepunch)
  }, (socket) => {
    socket
      .on('data', (data) => {
        if (b4a.toString(data) === 'Message from the client') {
          socket.end('The server received your message')
        }
      })
      .on('error', () => {})
  })
  await server.listen()

  const clientSocket = clientDht.connect(server.publicKey, { relayThrough: relayPubKey })
  await new Promise((resolve, reject) => {
    setTimeout(
      () => reject(new Error('The client socket did not receive a message from the server within the timeout limit')),
      sTimeout * 1000
    )
    clientSocket.on('data', (data) => {
      if (b4a.toString(data) === 'The server received your message') {
        resolve()
      }
    })
    clientSocket.on('error', () => {})
    clientSocket.write('Message from the client')
  })
}
