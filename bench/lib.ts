// Shared helpers for the benchmark modules.

import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const LIBS = ['@imlargo/air', 'ky', 'ofetch', 'axios'] as const
export type Lib = (typeof LIBS)[number]

// Read from disk: not every package exposes `./package.json` through its exports map.
export function versionOf(name: string): { version: string; dependencies: number } {
  const path = new URL(`./node_modules/${name}/package.json`, import.meta.url)
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
    version: string
    dependencies?: Record<string, string>
  }
  return {
    version: pkg.version,
    dependencies: Object.keys(pkg.dependencies ?? {}).length,
  }
}

export const json = (data: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function table(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

export const quantile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * q)),
  )
  return sorted[index] ?? 0
}
export const median = (values: readonly number[]): number => quantile(values, 0.5)

/** Coefficient of variation: standard deviation over the mean, as a fraction. */
export function cv(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return mean === 0 ? 0 : Math.sqrt(variance) / mean
}

/** Fisher-Yates shuffle, so each round runs the clients in a different order. */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i] as T
    copy[i] = copy[j] as T
    copy[j] = a
  }
  return copy
}

function start(module: string, args: readonly string[]) {
  const file = new URL(module, import.meta.url).pathname
  const child = spawn(process.execPath, ['--expose-gc', file, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  return { child, out: () => stdout, err: () => stderr }
}

/**
 * Runs a module in a fresh Node process and returns the JSON it prints. A fresh process per
 * measurement means no client inherits another's JIT state or heap.
 */
export function inChild<T>(module: string, args: readonly string[] = []): Promise<T> {
  const { child, out, err } = start(module, args)
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(
          new Error(`${module} ${args.join(' ')} exited with ${String(code)}\n${err()}`),
        )
        return
      }
      resolve(JSON.parse(out().trim().split('\n').at(-1) ?? 'null') as T)
    })
  })
}

/** Starts the server module, resolving with the port it prints and the process to stop later. */
export function startServer(
  module: string,
): Promise<{ port: number; child: ChildProcess }> {
  const { child, out, err } = start(module, [])
  return new Promise((resolve, reject) => {
    child.stdout.once('data', () => {
      const { port } = JSON.parse(out().split('\n')[0] ?? '{}') as { port: number }
      resolve({ port, child })
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      reject(new Error(`${module} exited with ${String(code)}: ${err()}`))
    })
  })
}

export function arg(name: string): string | undefined
export function arg(name: string, fallback: string): string
export function arg(name: string, fallback?: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}

export function requireArg(name: string): string {
  const value = arg(name)
  if (value === undefined) throw new Error(`missing --${name}=`)
  return value
}
