#!/usr/bin/env node
'use strict'
/** 采样桌面客户端 + 两个 dsh web 服务的 CPU/PSS，输出性能基线 JSON。 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const configDir = path.join(os.homedir(), '.config', 'dsh-desktop')
const outFile = path.join(configDir, 'perf-baseline.json')
const sampleSeconds = Number(process.env.PERF_SECONDS || 10)

function pidCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim()
  } catch {
    return ''
  }
}

function allPids() {
  return fs
    .readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
}

function ppidOf(pid) {
  try {
    return Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[3])
  } catch {
    return 0
  }
}

function treeOf(rootPid) {
  const parent = new Map()
  for (const pid of allPids()) parent.set(pid, ppidOf(pid))
  const result = [rootPid]
  for (const pid of allPids()) {
    let cursor = pid
    for (let depth = 0; depth < 20; depth += 1) {
      cursor = parent.get(cursor)
      if (!cursor) break
      if (cursor === rootPid) {
        result.push(pid)
        break
      }
    }
  }
  return [...new Set(result)]
}

function cpuTicks(pid) {
  try {
    const parts = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')
    return Number(parts[13]) + Number(parts[14])
  } catch {
    return 0
  }
}

function pssKb(pid) {
  try {
    for (const line of fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').split('\n')) {
      if (line.startsWith('Pss:')) return Number(line.split(/\s+/)[1]) || 0
    }
  } catch {
    // ignore
  }
  return 0
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const pids = allPids()
  const clientPid = pids.find((pid) => {
    const cmd = pidCmdline(pid)
    return cmd.includes('/opt/dsh-desktop/dsh-desktop') && !cmd.includes('--type=')
  })
  const dshPids = pids.filter((pid) => /dsh web --no-open --port (3080|3081)/.test(pidCmdline(pid)))
  if (!clientPid) {
    console.error('未找到桌面客户端进程')
    process.exit(1)
  }
  const dev = dshPids.find((pid) => pidCmdline(pid).includes('--port 3080'))
  const root = dshPids.find((pid) => pidCmdline(pid).includes('--port 3081'))
  const groups = {
    client: treeOf(clientPid),
    devService: dev ? treeOf(dev) : [],
    rootService: root ? treeOf(root) : [],
  }
  const before = {}
  for (const [name, group] of Object.entries(groups)) {
    before[name] = group.reduce((sum, pid) => sum + cpuTicks(pid), 0)
  }
  await sleep(sampleSeconds * 1000)
  const hz = Number(
    (() => {
      try {
        return require('node:os').constants ? 100 : 100
      } catch {
        return 100
      }
    })(),
  )
  const result = {
    ts: new Date().toISOString(),
    sampleSeconds,
    note: 'CPU% 为采样窗口内整棵树占用；PSS 为采样结束时的实际占用',
  }
  for (const [name, group] of Object.entries(groups)) {
    const after = group.reduce((sum, pid) => sum + cpuTicks(pid), 0)
    result[name] = {
      procs: group.length,
      cpuPct: Number((((after - before[name]) / 100 / sampleSeconds) * 100).toFixed(1)),
      pssMiB: Number((group.reduce((sum, pid) => sum + pssKb(pid), 0) / 1024).toFixed(1)),
    }
  }
  result.total = {
    cpuPct: Number(
      (result.client.cpuPct + result.devService.cpuPct + result.rootService.cpuPct).toFixed(1),
    ),
    pssMiB: Number(
      (result.client.pssMiB + result.devService.pssMiB + result.rootService.pssMiB).toFixed(1),
    ),
  }
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
