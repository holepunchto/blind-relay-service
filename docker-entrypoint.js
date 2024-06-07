#! /usr/bin/env node

try {
  require('dotenv').config()
} catch (e) {
  throw new Error('Install the optional dependencies to run the docker-entrypoint')
}

const pino = require('pino')

const goodbye = require('graceful-goodbye')
const idEncoding = require('hypercore-id-encoding')
const RAM = require('random-access-memory')

const setupMetricsServer = require('./lib/metrics')
const setupBlindRelay = require('.')

function loadConfig () {
  const res = {
    corestoreLoc: process.env.BLIND_RELAY_CORESTORE_LOC || './blind-relay-corestore',
    dhtPort: process.env.BLIND_RELAY_DHT_PORT || null,
    httpPort: process.env.BLIND_RELAY_HTTP_PORT || 0,
    httpHost: process.env.BLIND_RELAY_HTTP_HOST || '127.0.0.1',
    bootstrap: process.env._BLIND_RELAY_BOOTSTRAP_PORT // For tests
      ? [{ host: '127.0.0.1', port: parseInt(process.env._BLIND_RELAY_BOOTSTRAP_PORT) }]
      : null
  }

  if (process.env.BLIND_RELAY_USE_RAM === 'true') {
    res.corestoreLoc = RAM.reusable()
  }

  return res
}

async function main () {
  const config = loadConfig()
  const {
    dhtPort,
    httpPort,
    httpHost,
    bootstrap,
    corestoreLoc
  } = config

  const logger = pino()

  logger.info('Starting up blind relay')

  const { relay, server } = await setupBlindRelay({ storage: corestoreLoc, port: dhtPort, bootstrap })

  logger.info(`Relay server listening at public key ${idEncoding.encode(server.publicKey)}`)

  const metricsServer = setupMetricsServer(relay, logger)
  metricsServer.listen({
    host: httpHost,
    port: httpPort,
    listenTextResolver: (address) => {
      return `Prometheus metrics server is listening at ${address}`
    }
  })

  goodbye(async () => {
    logger.info('Shutting down the blind relay')
    await relay.close()
    await server.dht.destroy()
    await metricsServer.close()
    logger.info('Blind relay shut down')
  })
}

main()
