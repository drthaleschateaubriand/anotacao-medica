// Utilitários dos testes de ponta a ponta (Node 20, sem dependências). Nada aqui imprime a senha nem tokens.
import { existsSync, readFileSync } from 'node:fs'
export const BASE = process.env.FN_URL ?? 'https://kvikbqjmtlthywbgxdii.supabase.co/functions/v1'
export const ORIGIN = 'https://drthaleschateaubriand.github.io'
const PRIVATE = process.env.PRIVATE_DIR ?? '/workspace/anotacao-medica-private'
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '')
export const PASSWORD = process.env.APP_PASSWORD ?? read(`${PRIVATE}/senha.txt`)
export const ADMIN = process.env.ADMIN_TOKEN ?? read(`${PRIVATE}/admin_token.txt`).trim()

export async function call(fn, action, body = {}, token, extraHeaders = {}) {
  const r = await fetch(fn === 'data' ? `${BASE}/am-data` : `${BASE}/am-${fn}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: JSON.stringify(fn === 'data' ? { action, ...body } : body),
  })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: r.status, json, headers: r.headers }
}
export const login = (password = PASSWORD, extra = {}) => call('auth', 'login', { password, ...extra })
export const admin = (body, token = ADMIN) => call('admin', 'x', body, undefined, { 'x-admin-token': token })

/** Envia mensagem e consome o SSE. Retorna { status, events, text, done }. */
export async function chat(token, body) {
  const r = await fetch(`${BASE}/am-chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('event-stream')) return { status: r.status, events: [], text: '', json: await r.json().catch(() => null) }
  const events = []
  const dec = new TextDecoder()
  let buf = ''
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2)
      let ev = 'message', data = ''
      for (const l of block.split('\n')) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim() }
      if (data) events.push({ event: ev, data: JSON.parse(data) })
    }
  }
  const done = events.find((e) => e.event === 'done')
  const meta = events.find((e) => e.event === 'meta')
  return { status: r.status, events, done: done?.data?.message, text: done?.data?.message?.content ?? '', conversation_id: meta?.data?.conversation_id, error: events.find((e) => e.event === 'error')?.data }
}

let passed = 0, failed = 0
export function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`) } else { failed++; console.log(`  ✘ ${name} ${detail}`) }
}
export const section = (t) => console.log(`\n▶ ${t}`)
export function summary() { console.log(`\n${passed} ok, ${failed} falhas`); if (failed) process.exitCode = 1 }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
