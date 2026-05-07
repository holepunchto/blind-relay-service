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
    const port = flags.port ? parseInt(flags.port) : DEFAULT_PORT

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

      const promClient = instrumentation.promClient

      new promClient.Gauge({
        name: 'blind_relay_sessions_accepted',
        help: 'The total amount of relay sessions accepted',
        collect() {
          this.set(relay.stats.sessions.accepted)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_sessions_opened',
        help: 'The total amount of relay sessions opened',
        collect() {
          this.set(relay.stats.sessions.opened)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_sessions_closed',
        help: 'The total amount of relay sessions closed',
        collect() {
          this.set(relay.stats.sessions.closed)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_pairings_requested',
        help: 'The total amount of relay pairings requested',
        collect() {
          this.set(relay.stats.pairings.requested)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_pairings_matched',
        help: 'The total amount of relay pairings matched',
        collect() {
          this.set(relay.stats.pairings.matched)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_pairings_cancelled',
        help: 'The total amount of relay pairings cancelled',
        collect() {
          this.set(relay.stats.pairings.cancelled)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_pairings_pending',
        help: 'The amount of relay pairings pending',
        collect() {
          this.set(relay.stats.pairings.pending)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_pairings_active',
        help: 'The amount of relay pairings active',
        collect() {
          this.set(relay.stats.pairings.active)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_streams_opened',
        help: 'The total amount of relay streams opened',
        collect() {
          this.set(relay.stats.streams.opened)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_streams_closed',
        help: 'The total amount of relay streams closed',
        collect() {
          this.set(relay.stats.streams.closed)
        }
      })
      new promClient.Gauge({
        name: 'blind_relay_streams_errors',
        help: 'The total amount of relay stream errors',
        collect() {
          this.set(relay.stats.streams.errors)
        }
      })

      instrumentation.registerLogger(logger)
      await instrumentation.ready()
    }

    logger.info(`Server listening on ${id.encode(server.publicKey)}`)
  }
)

function noop() {}

cmd.parse()
