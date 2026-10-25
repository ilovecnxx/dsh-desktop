'use strict'

/**
 * 客户端壳（Electron 应用本身）的自更新。
 *
 * 更新源默认是本机的开发目录（可用 DSH_DESKTOP_SHELL_SOURCE 覆盖），
 * 也支持指向任意包含 main/preload/assets/package.json 的目录。
 * 更新只替换 ~/.local/opt/dsh-desktop/resources/app，不触碰 dsh 运行时与用户数据。
 *
 * 安全约束：只复制白名单条目，不执行更新源中的任何脚本。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compareVersions } = require('./updater')

const DEFAULT_APP_ROOT = path.join(os.homedir(), '.local', 'opt', 'dsh-desktop')
const COPY_ENTRIES = ['package.json', 'main', 'preload', 'assets', 'scripts', 'docs', 'README.md']

function appRoot() {
  return process.env.DSH_DESKTOP_APP_ROOT || DEFAULT_APP_ROOT
}

function installedAppDir() {
  return path.join(appRoot(), 'resources', 'app')
}

function sourceDir() {
  if (process.env.DSH_DESKTOP_SHELL_SOURCE) return process.env.DSH_DESKTOP_SHELL_SOURCE
  return path.join(os.homedir(), '文档', 'deepseek-harness', 'default-workspace', 'dsh-desktop')
}

function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** 已安装的客户端壳版本（读取 resources/app/package.json）。 */
function installedVersion() {
  return readPkg(installedAppDir())?.version || null
}

/** 更新源目录的版本。 */
function sourceVersion() {
  return readPkg(sourceDir())?.version || null
}

/**
 * 检查是否有新的客户端壳版本。
 * @returns {{available:boolean, current:string|null, latest:string|null, source:string, error?:string}}
 */
function checkForShellUpdate() {
  const src = sourceDir()
  const srcPkg = readPkg(src)
  const installed = installedVersion()
  if (!srcPkg || !srcPkg.version) {
    return {
      available: false,
      current: installed,
      latest: null,
      source: src,
      error: `找不到客户端更新源（${src}），可设置 DSH_DESKTOP_SHELL_SOURCE`,
    }
  }
  if (!installed) {
    return { available: true, current: null, latest: srcPkg.version, source: src }
  }
  return {
    available: compareVersions(srcPkg.version, installed) > 0,
    current: installed,
    latest: srcPkg.version,
    source: src,
  }
}

/**
 * 原子地把更新源安装到 resources/app：
 * 先复制到 app.staging 校验，再 app -> app.backup、app.staging -> app。
 * @returns {{ok:boolean, version:string, appDir:string}}
 */
function applyShellUpdate() {
  const src = sourceDir()
  const srcPkg = readPkg(src)
  if (!srcPkg || !srcPkg.version) {
    throw new Error(`找不到客户端更新源（${src}）`)
  }
  const root = appRoot()
  const resourcesDir = path.join(root, 'resources')
  const target = path.join(resourcesDir, 'app')
  const staging = path.join(resourcesDir, 'app.staging')
  const backup = path.join(resourcesDir, 'app.backup')

  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  try {
    for (const entry of COPY_ENTRIES) {
      const from = path.join(src, entry)
      if (!fs.existsSync(from)) continue
      fs.cpSync(from, path.join(staging, entry), { recursive: true, dereference: true })
    }
    const stagedPkg = readPkg(staging)
    if (!stagedPkg || !stagedPkg.version) {
      throw new Error('更新包校验失败：缺少 package.json/version')
    }
    fs.rmSync(backup, { recursive: true, force: true })
    if (fs.existsSync(target)) fs.renameSync(target, backup)
    try {
      fs.renameSync(staging, target)
    } catch (swapErr) {
      // 换入失败则回滚
      if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target)
      throw swapErr
    }
    return { ok: true, version: stagedPkg.version, appDir: target }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/** 回滚到上一个版本（如果存在备份）。 */
function rollbackShellUpdate() {
  const resourcesDir = path.join(appRoot(), 'resources')
  const target = path.join(resourcesDir, 'app')
  const backup = path.join(resourcesDir, 'app.backup')
  if (!fs.existsSync(backup)) return false
  fs.rmSync(target, { recursive: true, force: true })
  fs.renameSync(backup, target)
  return true
}

module.exports = {
  checkForShellUpdate,
  applyShellUpdate,
  rollbackShellUpdate,
  installedVersion,
  sourceVersion,
  sourceDir,
  appRoot,
}
