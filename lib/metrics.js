const fastify = require('fastify')
const promClient = require('prom-client')

function addPromMetrics (relay) {
  promClient.collectDefaultMetrics()

  new promClient.Gauge({ // eslint-disable-line no-new
    name: 'blind_relay_active_sessions',
    help: 'Total nr of relay sessions currently active',
    collect () {
      this.set(relay._sessions.size)
    }
  })
}

module.exports = function setupMetricsServer (relay, logger) {
  addPromMetrics(relay)

  const httpServer = fastify({ logger })

  httpServer.get('/metrics', { logLevel: 'warn' }, async function (req, reply) {
    const metrics = await promClient.register.metrics()
    reply.send(metrics)
  })

  httpServer.get('/health', { logLevel: 'warn' }, async function (req, reply) {
    reply.send('Healthy\n') // TODO: actual check
  })

  return httpServer
}
