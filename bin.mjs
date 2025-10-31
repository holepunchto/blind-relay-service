#!/usr/bin/env node

import path from 'path'
import { program, createOption } from 'commander'
import id from 'hypercore-id-encoding'
import DHT from 'hyperdht'
import Corestore from 'corestore'
import { Server as RelayServer } from 'blind-relay'
import replSwarm from 'repl-swarm'
import Instrumentation from 'hyper-instrument'
import pino from 'pino'
import goodbye from 'graceful-goodbye'

const SERVICE_NAME = 'blind-relay'

program
  .addOption(createOption('-s, --storage <path>').default('./corestore'))
  .addOption(createOption('-p, --port <num>').default(49737).argParser(Number))
  .addOption(createOption('-r, --repl').default(false))
  .addOption(createOption('--scraper-public-key <str>').default(null))
  .addOption(createOption('--scraper-secret <str>').default(null))
  .addOption(createOption('--scraper-alias <str>').default(null))
  .action(action)
  .parseAsync()
  .catch(err => {
    console.error(`error: ${err.message}`)
    process.exitCode = 1
  })

async function action (opts) {
  const logger = pino({ name: SERVICE_NAME })

  const corestoreLoc = path.resolve(opts.storage)
  logger.info(`Using corestore storage at ${corestoreLoc}`)
  const store = new Corestore(corestoreLoc)

  const dht = new DHT({ port: opts.port })

  const relay = new RelayServer({
    createStream (opts) {
      return dht.createRawStream({ ...opts, framed: true })
    }
  })

  const server = dht.createServer((socket) => {
    socket.setKeepAlive(5000)

    socket
      .on('error', noop)

    const session = relay.accept(socket, { id: socket.remotePublicKey })
    session
      .on('error', noop)
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

  if (opts.repl) {
    replSwarm({ dht, relay, server })
  }

  if (opts.scraperPublicKey) {
    logger.info('Setting up instrumentation')

    const scraperPublicKey = id.decode(opts.scraperPublicKey)
    const scraperSecret = id.decode(opts.scraperSecret)

    let prometheusAlias = opts.scraperAlias
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
      prometheusServiceName: SERVICE_NAME
    })

    instrumentation.registerLogger(logger)
    await instrumentation.ready()
  }

  logger.info(`Server listening on ${id.encode(server.publicKey)}`)
}

function noop () {}
