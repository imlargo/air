// Shared helpers for the benchmark modules.

import { readFileSync } from 'node:fs'

export const LIBS = ['@imlargo/air', 'ky', 'ofetch', 'axios']

// Read from disk: not every package exposes `./package.json` through its exports map.
export function versionOf(name) {
  const path = new URL(`./node_modules/${name}/package.json`, import.meta.url)
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  return {
    version: pkg.version,
    dependencies: Object.keys(pkg.dependencies ?? {}).length,
  }
}

export const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

/** A markdown table from a header row and body rows. */
export function table(header, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}
