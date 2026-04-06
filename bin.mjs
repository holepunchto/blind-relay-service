#!/usr/bin/env node

import path from 'path'
import { command, flag } from 'paparam'
import id from 'hypercore-id-encoding'
import DHT from 'hyperdht'
import Corestore from 'corestore'
import { Server as RelayServer } from 'blind-relay'
import Instrumentation from 'hyper-instrument'
import goodbye from 'graceful-goodbye'
import packageInfo from './package.json' with { type: 'json' }

const SERVICE_NAME = 'blind-relay'
const DEFAULT_STORAGE = './corestore'
const DEFAULT_PORT = 49737

const cmd = command(
  'blind-relay',
  flag('--storage|-s [path]'),
  flag('--port|-p [int]'),
  flag(
    '--scraper-public-key [scraper-public-key]',
    'Public key of a dht-prometheus scraper.  Can be hex or z32.'
  ),
  flag(
    '--scraper-secret [scraper-secret]',
    'Secret of the dht-prometheus scraper.  Can be hex or z32.'
  ),
  flag('--scraper-alias [scraper-alias]', '(optional) Alias with which to register to the scraper'),
  async function ({ flags }) {
    const logger = console // TODO: move back to pino
    const storage = flags.storage || DEFAULT_STORAGE
    const port = flags.port || DEFAULT_PORT
    const { scraperPublicKey, scraperSecret, scraperAlias } = flags

    const corestoreLoc = path.resolve(storage)
    logger.info(`Using corestore storage at ${corestoreLoc}`)
    const store = new Corestore(corestoreLoc)

    const dht = new DHT({ port })

    const relay = new RelayServer({
      createStream(opts) {
        return dht.createRawStream({ ...opts, framed: true })
      }
    })

    const server = dht.createServer((socket) => {
      socket.setKeepAlive(5000)

      socket.on('error', noop)

      const session = relay.accept(socket, { id: socket.remotePublicKey })
      session.on('error', noop)
    })

    let instrumentation = null
    goodbye(async () => {
      if (instrumentation) {
        logger.info('Closing instrumentation')
        await instrumentation.close()
      }
      logger.info('Shutting down blind relay')
      await dht.destroy()
      await store.close()
      logger.info('Shut down blind relay')
    })

    await server.listen(await store.createKeyPair('blind-relay'))

    if (scraperPublicKey) {
      logger.info('Setting up instrumentation')

      let prometheusAlias = scraperAlias
      if (prometheusAlias && prometheusAlias.length > 99) {
        throw new Error('The Prometheus alias must have length less than 100')
      }
      if (!prometheusAlias) {
        prometheusAlias = `${SERVICE_NAME}-${id.normalize(server.publicKey)}`.slice(0, 99)
      }

      instrumentation = new Instrumentation({
        dht,
        scraperPublicKey,
        prometheusAlias,
        scraperSecret,
        prometheusServiceName: SERVICE_NAME,
        version: packageInfo.version
      })

      instrumentation.registerLogger(logger)
      await instrumentation.ready()
    }

    logger.info(`Server listening on ${id.encode(server.publicKey)}`)
  }
)

function noop() {}

cmd.parse()
