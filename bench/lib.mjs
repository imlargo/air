// Shared helpers for the benchmark modules.

import { spawn } from 'node:child_process'
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

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

export function table(header, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

export const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * q)),
  )
  return sorted[index]
}
export const median = (values) => quantile(values, 0.5)

/** Coefficient of variation: standard deviation over the mean, as a fraction. */
export function cv(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return mean === 0 ? 0 : Math.sqrt(variance) / mean
}

/** Fisher-Yates shuffle, so each round runs the clients in a different order. */
export function shuffled(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Runs a module in a fresh Node process and returns the JSON it prints. A fresh process per
 * measurement means no client inherits another's JIT state or heap.
 */
export function inChild(module, args = [], { keepAlive = false } = {}) {
  const file = new URL(module, import.meta.url).pathname
  const child = spawn(process.execPath, ['--expose-gc', file, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))

  if (keepAlive) {
    // Resolve with the first JSON line and the handle, so the caller can stop the process later.
    return new Promise((resolve, reject) => {
      child.stdout.once('data', () =>
        resolve({ ...JSON.parse(stdout.split('\n')[0]), child }),
      )
      child.once('error', reject)
      child.once('exit', (code) =>
        reject(new Error(`${module} exited with ${code}: ${stderr}`)),
      )
    })
  }

  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0)
        return reject(
          new Error(`${module} ${args.join(' ')} exited with ${code}\n${stderr}`),
        )
      resolve(JSON.parse(stdout.trim().split('\n').at(-1)))
    })
  })
}

export const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}
