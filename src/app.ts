import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUI, { FastifySwaggerUiOptions } from '@fastify/swagger-ui'
import {
  TypeBoxTypeProvider,
  TypeBoxValidatorCompiler,
} from '@fastify/type-provider-typebox'
import fastify from 'fastify'
import fs from 'fs'
import path from 'path'
import pino from 'pino'
import { env } from './config/environment'
import crawlerRoutes from './modules/crawler/routes'
import { memoryRoutes } from './modules/memory/routes'

const isProd = env.NODE_ENV === 'production'
const packageJsonPath = path.join(import.meta.dirname, '..', 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
}

if (env.NODE_ENV !== 'production') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  }
}

const app = fastify({
  logger: loggerOptions,
  bodyLimit: 1048576, // 1MiB
  onProtoPoisoning: 'remove',
  caseSensitive: false,
  exposeHeadRoutes: true,
}).withTypeProvider<TypeBoxTypeProvider>()

app.setValidatorCompiler(TypeBoxValidatorCompiler)

await app.register(cors, {
  origin: isProd ? env.ALLOWED_ORIGINS : true,
  credentials: true,
})

await app.register(helmet)

await app.register(swagger, {
  swagger: {
    info: {
      title: 'Node.js API Template',
      description: 'API documentation for the Node.js template',
      version: packageJson.version,
    },
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
      },
    },
  },
})

await app.register(swaggerUI, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
  staticCSP: true,
  transformSpecification: (swaggerObject: object) => swaggerObject,
  transformSpecificationClone: true,
  exposeRoute: true,
} as FastifySwaggerUiOptions)

await app.register(multipart)

// Register your application modules here
app.register(crawlerRoutes, { prefix: '/api/crawler' })
app.register(memoryRoutes, { prefix: '/api/memory' })

app.get('/healthz', {
  schema: {
    description: 'Health check endpoint',
    tags: ['system'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          timestamp: { type: 'string' },
        },
      },
    },
  },
  handler: async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  },
})

// Centralized error handler
app.setErrorHandler((error, _, reply) => {
  app.log.error(error)
  reply.status(error.statusCode || 500).send({
    error: error.name || 'InternalServerError',
    message: error.message || 'An unknown error occurred',
    statusCode: error.statusCode || 500,
  })
})

export default app
