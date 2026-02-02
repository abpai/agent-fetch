import esbuild from 'esbuild'
import { readFileSync } from 'fs'

const { dependencies } = JSON.parse(readFileSync('./package.json', 'utf8'))

esbuild
  .build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/server.js',
    format: 'esm',
    external: Object.keys(dependencies),
  })
  .catch(() => process.exit(1))
