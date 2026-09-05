// What the numbers were measured on. Without this a benchmark is a claim, not a measurement.

import os from 'node:os'
import { versionOf } from './lib.mjs'

export function environment() {
  const cpu = os.cpus()[0]?.model ?? 'unknown CPU'
  const load = os.loadavg()[0].toFixed(2)
  return {
    runtime: globalThis.navigator?.userAgent ?? `Node.js ${process.version}`,
    platform: `${process.platform} ${process.arch}`,
    cpu: `${cpu}, ${os.cpus().length} threads, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`,
    threads: os.cpus().length,
    loadBefore: Number(load),
    ci: process.env.GITHUB_ACTIONS ? 'GitHub Actions shared runner' : 'local machine',
    esbuild: versionOf('esbuild').version,
    date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  }
}
