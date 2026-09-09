// Bundle size per library, as an application would ship it: esbuild, minified, ESM, then gzip.
//
// air splits its features across entry points, so its root entry is not the same product as a
// library that ships retry, timeouts and hooks from one. Rather than leave the reader to guess
// what is missing, the comparable combinations are measured too.

import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { table } from './lib.ts'

const HAS_DEFAULT = new Set<string>(['@imlargo/air', 'ky', 'axios'])

const SUBPATHS = ['retry', 'refresh', 'progress', 'form', 'query'].map(
  (name) => `@imlargo/air/${name}`,
)

const ENTRIES: [label: string, specifiers: readonly string[]][] = [
  ['`@imlargo/air`', ['@imlargo/air']],
  ['`@imlargo/air` + `air/retry`', ['@imlargo/air', '@imlargo/air/retry']],
  ['`@imlargo/air`, every entry point', ['@imlargo/air', ...SUBPATHS]],
  ['`ky`', ['ky']],
  ['`ofetch`', ['ofetch']],
  ['`axios`', ['axios']],
]

async function bundle(specifiers: readonly string[], platform: 'browser' | 'node') {
  const contents = specifiers
    .map(
      (name) =>
        `export * from '${name}'\n${HAS_DEFAULT.has(name) ? `export { default } from '${name}'\n` : ''}`,
    )
    .join('')
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
  const code = result.outputFiles[0]?.contents ?? new Uint8Array()
  return { raw: code.byteLength, gzip: gzipSync(code, { level: 9 }).byteLength }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`

export async function sizes(): Promise<string> {
  const rows: string[][] = []
  for (const [label, specifiers] of ENTRIES) {
    const browser = await bundle(specifiers, 'browser')
    const node = await bundle(specifiers, 'node')
    rows.push([label, kb(browser.gzip), kb(node.gzip), kb(browser.raw), kb(node.raw)])
  }
  return table(
    [
      'Entry point',
      'Browser, min+gzip',
      'Node, min+gzip',
      'Browser, minified',
      'Node, minified',
    ],
    rows,
  )
}
