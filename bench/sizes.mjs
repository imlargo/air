// Bundle size per library, as an application would ship it: esbuild, minified, ESM, then gzip.

import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { LIBS, table } from './lib.mjs'

const HAS_DEFAULT = new Set(['@imlargo/air', 'ky', 'axios'])

async function bundle(name, platform) {
  const contents = `export * from '${name}'\n${HAS_DEFAULT.has(name) ? `export { default } from '${name}'\n` : ''}`
  const result = await build({
    stdin: { contents, resolveDir: new URL('.', import.meta.url).pathname },
    bundle: true,
    minify: true,
    format: 'esm',
    platform,
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].contents
  return { raw: code.byteLength, gzip: gzipSync(code, { level: 9 }).byteLength }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

export async function sizes() {
  const rows = []
  for (const name of LIBS) {
    const browser = await bundle(name, 'browser')
    const node = await bundle(name, 'node')
    rows.push([
      `\`${name}\``,
      kb(browser.gzip),
      kb(node.gzip),
      kb(browser.raw),
      kb(node.raw),
    ])
  }
  return table(
    [
      'Library',
      'Browser, min+gzip',
      'Node, min+gzip',
      'Browser, minified',
      'Node, minified',
    ],
    rows,
  )
}
