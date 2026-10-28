'use strict'

/**
 * 第三方模型 API 接入：
 * - 我方配置文件：<userData>/third-party-apis.json（不含明文密钥）
 * - 密钥：$DSH_HOME/.credentials.yaml 的 refs（由 dsh-credentials-local 自动重载）
 * - 提供商：$DSH_HOME/profiles/web/cordis.patch.yml 的 llm-pi-ai providers
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const API_CHOICES = [
  { id: 'openai-completions', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' },
]

const MANAGED_START = '# >>> dsh-desktop third-party providers (managed) >>>'
const MANAGED_END = '# <<< dsh-desktop third-party providers (managed) <<<'
const KEY_START = '# >>> dsh-desktop api keys (managed) >>>'
const KEY_END = '# <<< dsh-desktop api keys (managed) <<<'

function credentialRef(route) {
  return `${String(route).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, content, { mode })
  fs.renameSync(temp, file)
}

class ProviderService {
  constructor({ userData, dshHome, log }) {
    this.userData = userData
    this.dshHome = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    this.log = log || (() => {})
    this.storeFile = path.join(userData, 'third-party-apis.json')
    this.patchFile = path.join(this.dshHome, 'profiles', 'web', 'cordis.patch.yml')
    this.credentialsFile = path.join(this.dshHome, '.credentials.yaml')
    this.store = this.loadStore()
  }

  loadStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'))
      return {
        version: 1,
        providers: raw.providers && typeof raw.providers === 'object' ? raw.providers : {},
        default: raw.default || null,
      }
    } catch {
      return { version: 1, providers: {}, default: null }
    }
  }

  saveStore() {
    atomicWrite(this.storeFile, JSON.stringify(this.store, null, 2) + '\n', 0o600)
  }

  credentialRefs() {
    try {
      const text = fs.readFileSync(this.credentialsFile, 'utf8')
      const refs = {}
      for (const match of text.matchAll(/^\s{2}([A-Z0-9_]+):\s*(.+)$/gm)) {
        refs[match[1]] = match[2].replace(/^["']|["']$/g, '').length > 0
      }
      return refs
    } catch {
      return {}
    }
  }

  list() {
    const configured = this.credentialRefs()
    const providers = Object.values(this.store.providers).map((item) => ({
      ...item,
      apiKeyRef: credentialRef(item.route),
      keyConfigured: Boolean(configured[credentialRef(item.route)]),
    }))
    return {
      providers,
      default: this.store.default,
      dshHome: this.dshHome,
      patchFile: this.patchFile,
      credentialsFile: this.credentialsFile,
      apiChoices: API_CHOICES,
    }
  }

  validate(input) {
    const route = String(input.route || '').trim()
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(route)) {
      throw new Error('路由名需以小写字母开头，只能包含小写字母、数字和连字符')
    }
    const api = String(input.api || '')
    if (!API_CHOICES.some((item) => item.id === api)) throw new Error('协议不受支持')
    const baseURL = String(input.baseURL || '').trim()
    if (!/^https?:\/\//i.test(baseURL)) throw new Error('API 地址需以 http:// 或 https:// 开头')
    const models = (Array.isArray(input.models) ? input.models : [])
      .map((item) => ({
        id: String(item.id || '').trim(),
        ...(item.name ? { name: String(item.name).trim() } : {}),
      }))
      .filter((item) => item.id.length > 0)
    if (models.length === 0) throw new Error('至少填写一个模型 ID')
    const unique = new Set()
    for (const model of models) {
      if (unique.has(model.id)) throw new Error(`模型 ID 重复：${model.id}`)
      unique.add(model.id)
    }
    const displayName = String(input.displayName || route).trim() || route
    const apiKey = String(input.apiKey || '').trim()
    const setDefault = Boolean(input.setDefault)
    return { route, displayName, api, baseURL, models, apiKey, setDefault }
  }

  save(input) {
    const provider = this.validate(input)
    const ref = credentialRef(provider.route)
    const previous = this.store.providers[provider.route]
    const hasStoredKey = Boolean(this.credentialRefs()[ref])
    if (!provider.apiKey && !hasStoredKey) throw new Error('请填写 API 密钥')
    this.store.providers[provider.route] = {
      route: provider.route,
      displayName: provider.displayName,
      api: provider.api,
      baseURL: provider.baseURL,
      models: provider.models,
    }
    if (provider.setDefault) {
      this.store.default = { provider: provider.route, model: provider.models[0].id }
    } else if (this.store.default && this.store.default.provider === provider.route) {
      const stillExists = provider.models.some((item) => item.id === this.store.default.model)
      if (!stillExists) this.store.default = { provider: provider.route, model: provider.models[0].id }
    }
    this.saveStore()
    this.writeCredentials(provider.route, provider.apiKey)
    this.writePatch()
    this.log(`第三方 API 已保存：${provider.route}（${provider.api}，${provider.models.length} 个模型）`)
    return {
      ok: true,
      message: `已保存「${provider.displayName}」；如未立即生效，点「重启服务」`,
      patchFile: this.patchFile,
      previous: Boolean(previous),
    }
  }

  remove(route) {
    const name = String(route || '')
    if (!this.store.providers[name]) throw new Error('提供商不存在')
    delete this.store.providers[name]
    if (this.store.default && this.store.default.provider === name) this.store.default = null
    this.saveStore()
    this.writeCredentials()
    this.writePatch()
    this.log(`第三方 API 已删除：${name}`)
    return { ok: true, message: `已删除 ${name}` }
  }

  writeCredentials(changedRoute, apiKey) {
    const refs = new Map()
    for (const route of Object.keys(this.store.providers)) {
      refs.set(credentialRef(route), null)
    }
    if (changedRoute && apiKey) refs.set(credentialRef(changedRoute), apiKey)

    let text = ''
    try {
      text = fs.readFileSync(this.credentialsFile, 'utf8')
    } catch {
      text = 'version: 1\n'
    }
    // 旧密钥从文件读取，保持未变更的提供商密钥
    const existing = new Map()
    for (const match of text.matchAll(/^\s{2}([A-Z0-9_]+):\s*(.+)$/gm)) {
      existing.set(match[1], match[2])
    }
    for (const [ref, value] of refs) {
      if (value) continue
      if (existing.has(ref)) refs.set(ref, existing.get(ref).replace(/^["']|["']$/g, ''))
    }
    // 移除旧的管理块
    const lines = text.split('\n')
    const cleaned = []
    let skipping = false
    for (const line of lines) {
      if (line.trim() === KEY_START) { skipping = true; continue }
      if (line.trim() === KEY_END) { skipping = false; continue }
      if (!skipping) cleaned.push(line)
    }
    let body = cleaned.join('\n')
    if (!/^version:\s*\d+/m.test(body)) body = 'version: 1\n' + body
    let refsLine = body.split('\n').findIndex((line) => /^refs:\s*(?:\{\}\s*)?$/.test(line))
    if (refsLine === -1) {
      body = body.replace(/\s*$/, '\n') + 'refs:\n'
      refsLine = body.split('\n').findIndex((line) => /^refs:/.test(line))
    } else {
      body = body.replace(/^refs:.*$/m, 'refs:')
    }
    const block = [`  ${KEY_START}`]
    for (const [ref, value] of refs) {
      if (!value) continue
      block.push(`  ${ref}: ${JSON.stringify(String(value))}`)
    }
    block.push(`  ${KEY_END}`)
    const out = body.split('\n')
    out.splice(refsLine + 1, 0, ...block)
    atomicWrite(this.credentialsFile, out.join('\n'), 0o600)
  }

  writePatch() {
    const providers = {}
    for (const item of Object.values(this.store.providers)) {
      providers[item.route] = {
        ...(item.displayName && item.displayName !== item.route ? { displayName: item.displayName } : {}),
        api: item.api,
        baseURL: item.baseURL,
        apiKeyEnv: credentialRef(item.route),
        models: item.models,
      }
    }
    const entries = [{ id: 'llm-pi-ai', config: { providers } }]
    if (this.store.default) {
      entries.push({
        id: 'agent-default-model',
        config: { provider: this.store.default.provider, model: this.store.default.model },
      })
    }
    const block = [
      MANAGED_START,
      ...entries.flatMap((entry) => [
        `- id: ${entry.id}`,
        '  config:',
        ...Object.entries(entry.config).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
      ]),
      MANAGED_END,
    ].join('\n')

    let text = ''
    try {
      text = fs.readFileSync(this.patchFile, 'utf8')
    } catch {
      text = ''
    }
    const lines = text.split('\n')
    const kept = []
    let skipping = false
    for (const line of lines) {
      if (line.trim() === MANAGED_START) { skipping = true; continue }
      if (line.trim() === MANAGED_END) { skipping = false; continue }
      if (!skipping) kept.push(line)
    }
    const next = kept.join('\n').replace(/\s*$/, '') + '\n\n' + block + '\n'
    atomicWrite(this.patchFile, next, 0o644)
  }

  async test(input) {
    const provider = this.validate({ ...input, apiKey: input.apiKey || 'placeholder' })
    let key = String(input.apiKey || '').trim()
    if (!key) {
      try {
        const text = fs.readFileSync(this.credentialsFile, 'utf8')
        const ref = credentialRef(provider.route)
        const match = text.match(new RegExp(`^\\s{2}${ref}:\\s*(.+)$`, 'm'))
        if (match) key = match[1].replace(/^["']|["']$/g, '')
      } catch {
        // ignore
      }
    }
    const base = provider.baseURL.replace(/\/+$/, '')
    const anthropic = provider.api === 'anthropic-messages'
    const url = anthropic ? `${base}/v1/models` : `${base}/models`
    const headers = anthropic
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : key
        ? { Authorization: `Bearer ${key}` }
        : {}
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(12000) })
      if (response.ok) return { ok: true, message: `连接成功（HTTP ${response.status}）` }
      if (response.status === 404) {
        return { ok: true, message: '接口可达（/models 返回 404，网关可能不支持模型列表）' }
      }
      const detail = await response.text().catch(() => '')
      return {
        ok: false,
        message: `连接失败：HTTP ${response.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`,
      }
    } catch (err) {
      return { ok: false, message: `连接失败：${err.message}` }
    }
  }
}

module.exports = { ProviderService, credentialRef, API_CHOICES }
