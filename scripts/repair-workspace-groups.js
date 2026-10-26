#!/usr/bin/env node
'use strict'
/**
 * 修复「未分组」会话：按 session 元数据 cwd 把游离 session 重新加入对应工作区。
 * 仅修改 ~/.dsh/storages/workspace.json；建议在 dsh 服务停止时运行。
 * 用法：node scripts/repair-workspace-groups.js [--dry-run]
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const dryRun = process.argv.includes('--dry-run')
const home = process.env.HOME || os.homedir()
const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
const workspaceFile = path.join(dshHome, 'storages', 'workspace.json')
const sessionsRoot = path.join(dshHome, 'sessions')

function readMeta(file) {
  try {
    const text = execFileSync('zstd', ['-dc', file], { encoding: 'utf8', timeout: 15000 })
    const first = text.split('\n', 1)[0]
    return JSON.parse(first)
  } catch {
    return null
  }
}

function main() {
  const store = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'))
  const workspaces = store.tables.workspaces
  const pathToId = new Map()
  const accounted = new Set()
  for (const [id, item] of Object.entries(workspaces)) {
    pathToId.set(path.resolve(item.path), id)
    for (const sid of item.sessionIds || []) accounted.add(sid)
  }
  const candidates = []
  for (const workspaceDir of fs.readdirSync(sessionsRoot)) {
    const dir = path.join(sessionsRoot, workspaceDir)
    let stat
    try {
      stat = fs.statSync(dir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    for (const sessionDir of fs.readdirSync(dir)) {
      const sessionPath = path.join(dir, sessionDir)
      const file = path.join(sessionPath, 'session.v4.jsonl.zstd')
      if (!fs.existsSync(file)) continue
      const meta = readMeta(file)
      if (!meta || !meta.id || !meta.cwd) continue
      if (accounted.has(meta.id)) continue
      const wid = pathToId.get(path.resolve(meta.cwd))
      if (!wid) continue
      candidates.push({ id: meta.id, cwd: meta.cwd, workspaceId: wid, mtime: fs.statSync(file).mtimeMs })
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  if (candidates.length === 0) {
    console.log('没有需要修复的游离会话')
    return
  }
  const backup = `${workspaceFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  if (!dryRun) fs.copyFileSync(workspaceFile, backup)
  for (const item of candidates) {
    workspaces[item.workspaceId].sessionIds.push(item.id)
    workspaces[item.workspaceId].updatedAt = new Date().toISOString()
    console.log(`+ ${item.id} -> ${workspaces[item.workspaceId].title} (${item.cwd})`)
  }
  if (dryRun) {
    console.log(`[dry-run] 将修复 ${candidates.length} 个会话，未写盘`)
    return
  }
  const tmp = `${workspaceFile}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, workspaceFile)
  console.log(`已修复 ${candidates.length} 个会话，备份：${backup}`)
}

main()
