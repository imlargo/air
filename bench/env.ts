// What the numbers were measured on. Without this a benchmark is a claim, not a measurement.

import os from 'node:os'
import { versionOf } from './lib.ts'

export function environment() {
  const [cpu] = os.cpus()
  return {
    runtime: navigator.userAgent,
    platform: `${process.platform} ${process.arch}`,
    cpu: `${cpu?.model ?? 'unknown CPU'}, ${os.cpus().length} threads, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`,
    threads: os.cpus().length,
    loadBefore: Number((os.loadavg()[0] ?? 0).toFixed(2)),
    ci: process.env.GITHUB_ACTIONS ? 'GitHub Actions shared runner' : 'local machine',
    esbuild: versionOf('esbuild').version,
    date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  }
}
