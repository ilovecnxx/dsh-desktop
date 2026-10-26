'use strict'

/**
 * 读取 ~/.dsh/sessions 下最近的会话标题（只读，不修改会话数据）。
 * 会话文件为 session.v4.jsonl.zstd，标题来自最新的 session/title 事件；
 * 没有标题时回退到第一条用户消息。
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { execFile } = require('node:child_process')

const MAX_SESSION_BYTES = 4 * 1024 * 1024

function pickTitleFromLines(text) {
  let title = ''
  let firstUserText = ''
  for (const line of text.split('\n')) {
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!title && event.type === 'session/title' && event.data && event.data.title) {
      title = String(event.data.title)
    }
    if (!firstUserText && event.type === 'agent/inbox/spliced') {
      const inserted = event.data && event.data.inserted
      if (Array.isArray(inserted)) {
        for (const item of inserted) {
          if (item && item.role === 'user' && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part && part.type === 'text' && part.text) {
                firstUserText = String(part.text)
                break
              }
            }
          }
          if (firstUserText) break
        }
      }
    }
    if (title) break
  }
  return title || firstUserText
}

function cleanTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 34 ? `${text.slice(0, 33)}…` : text
}

/** 收集所有会话文件（workspace/session-id/session.v4.jsonl.zstd）。 */
function collectSessionFiles(root) {
  const found = []
  let workspaces
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const workspaceDir = path.join(root, workspace.name)
    let sessions
    try {
      sessions = fs.readdirSync(workspaceDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const file = path.join(workspaceDir, session.name, 'session.v4.jsonl.zstd')
      let stat
      try {
        stat = fs.statSync(file)
      } catch {
        continue
      }
      found.push({ id: session.name, workspace: workspace.name, file, mtime: stat.mtimeMs, size: stat.size })
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found
}

/**
 * @param {string} root 会话根目录（默认 ~/.dsh/sessions）
 * @param {number} limit 返回数量
 * @returns {Array<{id:string,workspace:string,title:string,mtime:number}>}
 */
/** 用系统 zstd 解压多个连续帧；没有 zstd 时退回 Node（只能解第一帧）。 */
function decompressSessionFile(file) {
  return new Promise((resolve) => {
    execFile('zstd', ['-dc', file], { maxBuffer: 16 * 1024 * 1024, timeout: 4000 }, (err, stdout) => {
      if (!err && stdout) {
        resolve(stdout.toString('utf8'))
        return
      }
      try {
        resolve(zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8'))
      } catch {
        resolve('')
      }
    })
  })
}

/**
 * @param {string} root 会话根目录（默认 ~/.dsh/sessions）
 * @param {number} limit 返回数量
 * @returns {Promise<Array<{id:string,workspace:string,title:string,rawTitle:string,mtime:number}>>}
 */
async function listRecentSessions(root, limit = 8) {
  const sessions = []
  for (const entry of collectSessionFiles(root)) {
    let rawTitle = ''
    if (entry.size <= MAX_SESSION_BYTES) {
      const text = await decompressSessionFile(entry.file)
      rawTitle = cleanTitle(pickTitleFromLines(text))
    }
    sessions.push({
      id: entry.id,
      workspace: entry.workspace,
      title: rawTitle || `会话 ${entry.id.slice(0, 12)}`,
      rawTitle: rawTitle || '',
      mtime: entry.mtime,
      file: entry.file,
    })
    if (sessions.length >= limit) break
  }
  return sessions
}

/**
 * 把会话事件转换为 Markdown（只导出用户/助手文本，跳过推理与工具调用明细）。
 * @param {Array<object>} events
 * @param {{exportedAt?:string}} [opts]
 */
function eventsToMarkdown(events, opts = {}) {
  let title = ''
  const blocks = []
  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue
    if (event.type === 'session/title' && event.data && event.data.title) {
      title = String(event.data.title)
      continue
    }
    if (event.type === 'agent/inbox/spliced') {
      const inserted = event.data && event.data.inserted
      if (!Array.isArray(inserted)) continue
      for (const item of inserted) {
        if (!item || item.role !== 'user' || !Array.isArray(item.content)) continue
        const text = item.content
          .filter((part) => part && part.type === 'text' && part.text)
          .map((part) => String(part.text))
          .join('\n')
          .trim()
        if (text) blocks.push(`## 🧑 用户\n\n${text}`)
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = event.data && event.data.message
      if (!message || !Array.isArray(message.content)) continue
      const text = message.content
        .filter((part) => part && part.type === 'text' && part.text)
        .map((part) => String(part.text))
        .join('\n')
        .trim()
      if (text) blocks.push(`## 🤖 助手\n\n${text}`)
    }
  }
  const heading = title ? `# ${title}` : '# DeepSeek Harness 会话'
  const exportedAt = opts.exportedAt || new Date().toISOString()
  return `${heading}\n\n> 导出时间：${exportedAt}\n\n${blocks.join('\n\n---\n\n')}\n`
}

/** 读取一个已解压的/压缩的会话文件并转成 Markdown。 */
async function sessionToMarkdown(file) {
  const text = await decompressSessionFile(file)
  const events = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // ignore malformed line
    }
  }
  return eventsToMarkdown(events)
}

module.exports = {
  listRecentSessions,
  pickTitleFromLines,
  cleanTitle,
  collectSessionFiles,
  decompressSessionFile,
  eventsToMarkdown,
  sessionToMarkdown,
}
