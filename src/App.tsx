import { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, CatalogProvider, Conversation, Message, Preferences, SessionTokens, Skill } from './types'
import { ApiError, data, streamChat } from './services/api'
import { clearSession, loadSession, onSessionChange } from './services/session'
import * as auth from './services/auth'
import { AuthScreen } from './components/AuthScreen'
import { Sidebar } from './components/Sidebar'
import { ChatView, type ChatError, type StreamState } from './components/ChatView'
import { SettingsModal, type SettingsTab } from './components/SettingsModal'
import { NotesView } from './components/NotesView'
import { speak } from './lib/speech'

const DEFAULT_PREFS: Preferences = { theme: 'system', font_size: 'md', language: 'pt-BR', memory_enabled: true, default_model: 'auto', auto_speak: false }
const FONT_PX = { sm: '14px', md: '16px', lg: '18px' }

function applyPrefs(p: Preferences) {
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.setProperty('--msg-fs', FONT_PX[p.font_size])
  document.documentElement.lang = p.language
  try { localStorage.setItem('am.theme', p.theme) } catch { /* ignore */ }
}

/** Rotas por hash: #/ ou #/n/<id> = Notas (tela inicial); #/chat ou #/c/<id> = Chat IA. */
type Route = { view: 'notes' | 'chat'; id: string | null }
function parseRoute(): Route {
  const c = /^#\/c\/([0-9a-f-]{36})/i.exec(location.hash)
  if (c) return { view: 'chat', id: c[1].toLowerCase() }
  if (/^#\/chat/.test(location.hash)) return { view: 'chat', id: null }
  const n = /^#\/n\/([0-9a-f-]{36})/i.exec(location.hash)
  return { view: 'notes', id: n ? n[1].toLowerCase() : null }
}

export default function App() {
  const [session, setSession] = useState<SessionTokens | null>(loadSession())
  useEffect(() => onSessionChange(() => setSession(loadSession())), [])

  if (!session) return <AuthScreen />
  return <Main key={session.refresh.slice(0, 8) /* remonta ao trocar de sessão */ } />
}

function Main() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [route, setRoute] = useState<Route>(parseRoute())
  const view = route.view
  const activeId = route.view === 'chat' ? route.id : null
  const lastChat = useRef<string | null>(null)
  const lastNote = useRef<string | null>(null)
  if (route.view === 'chat') lastChat.current = route.id
  else lastNote.current = route.id
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [stream, setStream] = useState<StreamState | null>(null)
  const [error, setError] = useState<ChatError | null>(null)
  const [catalog, setCatalog] = useState<CatalogProvider[] | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settings, setSettings] = useState<SettingsTab | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [newAgent, setNewAgent] = useState<string | null>(null) // agente da PRÓXIMA conversa (quando nenhuma está aberta)
  const newAgentRef = useRef<string | null>(null)
  newAgentRef.current = newAgent
  const [toast, setToast] = useState('')
  const streamRef = useRef<{ convId: string | null; ctrl: AbortController } | null>(null)
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }, [])

  const loggedOut = useCallback(() => { clearSession() }, [])

  // bootstrap
  useEffect(() => {
    data('bootstrap').then((j) => {
      if (j.preferences) { setPrefs(j.preferences); applyPrefs(j.preferences) }
      setConvs(j.conversations)
      setAgents(j.agents ?? [])
      setSkills(j.skills ?? [])
    }).catch((e) => { if (!(e instanceof ApiError && e.status === 401)) flash('Não foi possível carregar seus dados. Verifique a conexão.') })
  }, [])

  // roteamento por hash
  useEffect(() => {
    const h = () => setRoute(parseRoute())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const go = (id: string | null) => { location.hash = id ? `#/c/${id}` : '#/chat' }
  const goNote = useCallback((id: string | null) => { location.hash = id ? `#/n/${id}` : '#/' }, [])

  const loadMessages = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const j = await data('conv.messages', { id })
      if (activeRef.current !== id || streamRef.current) return
      setMessages((old) => {
        const same = old.length === j.messages.length && old[old.length - 1]?.id === j.messages[j.messages.length - 1]?.id && old[old.length - 1]?.content === j.messages[j.messages.length - 1]?.content
        return same ? old : j.messages
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { go(null); setMessages([]) }
    } finally { if (!silent) setLoading(false) }
  }, [])

  useEffect(() => {
    setError(null)
    if (streamRef.current && streamRef.current.convId === activeId) return // conversa recém-criada em streaming
    if (!activeId) { setMessages([]); return }
    setMessages([])
    loadMessages(activeId)
  }, [activeId, loadMessages])

  // sincronização entre dispositivos: ao focar, ao voltar online e a cada 20 s
  const refreshList = useCallback(async () => {
    try {
      const j = await data('conv.list')
      setConvs((old) => (JSON.stringify(old) === JSON.stringify(j.conversations) ? old : j.conversations))
      if (activeRef.current && !streamRef.current) loadMessages(activeRef.current, true)
    } catch { /* offline: tenta depois */ }
  }, [loadMessages])
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible') refreshList() }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', vis)
    window.addEventListener('online', vis)
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshList() }, 20000)
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); window.removeEventListener('online', vis); clearInterval(t) }
  }, [refreshList])

  const updatePrefs = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    applyPrefs(next)
    data('prefs.update', patch as Record<string, unknown>).catch(() => flash('Não foi possível salvar a preferência.'))
  }
  useEffect(() => {
    if (prefs.theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const h = () => applyPrefs(prefsRef.current)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [prefs.theme])

  const loadCatalog = useCallback(() => { data('models.list').then((j) => setCatalog(j.catalog)).catch(() => {}) }, [])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  // --- envio / streaming ---
  const run = useCallback(async (mode: 'send' | 'regenerate' | 'continue', content?: string) => {
    if (streamRef.current) return
    const convId = activeRef.current
    const ctrl = new AbortController()
    streamRef.current = { convId, ctrl }
    setError(null)
    setStream({ convId, text: '', phase: 'connecting', notice: '', continuing: mode === 'continue' })
    if (mode === 'send') setMessages((m) => [...m, { id: 'tmp-' + Date.now(), role: 'user', content: content!, created_at: new Date().toISOString(), pending: true }])
    if (mode === 'regenerate') setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' ? m.slice(0, -1) : m))
    let acc = ''
    let raf = 0
    const flush = () => { raf = 0; setStream((s) => (s ? { ...s, text: acc, phase: 'streaming' } : s)) }
    let finished = false
    try {
      await streamChat({ conversation_id: convId ?? undefined, mode, content, model: prefsRef.current.default_model, ...(!convId && newAgentRef.current ? { agent_id: newAgentRef.current } : {}) }, {
        signal: ctrl.signal,
        onEvent: (ev, d) => {
          if (ev === 'meta') {
            if (d.user_message) setMessages((m) => m.map((x) => (x.pending ? d.user_message : x)))
            if (d.conversation_id && streamRef.current) {
              streamRef.current.convId = d.conversation_id
              if (!convId) { activeRef.current = d.conversation_id; setNewAgent(null); go(d.conversation_id) }
              setConvs((old) => (old.some((c) => c.id === d.conversation_id) ? old : [{ id: d.conversation_id, title: d.title, pinned: false, agent_id: d.agent_id ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...old]))
            }
          } else if (ev === 'attempt') setStream((s) => (s && !acc ? { ...s, notice: `Consultando ${d.provider}…` } : s))
          else if (ev === 'delta') { acc += d.t; if (!raf) raf = requestAnimationFrame(flush) }
          else if (ev === 'reset') { acc = ''; setStream((s) => (s ? { ...s, text: '', notice: 'Trocando de modelo…' } : s)) }
          else if (ev === 'fallback') setStream((s) => (s ? { ...s, notice: `${d.provider} indisponível (${d.kind === 'rate_limit' ? 'limite atingido' : d.kind}); tentando outro modelo…` } : s))
          else if (ev === 'done') {
            finished = true
            const msg = d.message as Message
            setMessages((m) => (mode === 'continue' ? m.map((x) => (x.id === msg.id ? msg : x)) : [...m.filter((x) => x.id !== msg.id), msg]))
            if (prefsRef.current.auto_speak) speak(msg.content, prefsRef.current.language)
          } else if (ev === 'error') {
            setError({ message: d.message, retryAfter: d.retry_after, canRetry: true })
          }
        },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        if (e instanceof ApiError && e.status === 429) setError({ message: `Muitas mensagens em pouco tempo. Aguarde ${e.retryAfter ?? 30}s.`, retryAfter: e.retryAfter, canRetry: false })
        else if (!(e instanceof ApiError && e.status === 401)) setError({ message: e instanceof Error ? e.message : 'Falha de conexão.', canRetry: mode !== 'send' || true })
      }
    } finally {
      if (raf) cancelAnimationFrame(raf)
      const id = streamRef.current?.convId ?? convId
      streamRef.current = null
      setStream(null)
      if (!finished && id) loadMessages(id, true) // recupera o que o servidor gravou (ex.: parada manual)
      refreshList()
    }
  }, [loadMessages, refreshList])

  const doDelete = async (id: string) => {
    try { await data('conv.delete', { id }); setConvs((c) => c.filter((x) => x.id !== id)); if (activeRef.current === id) go(null) } catch { flash('Não foi possível excluir.') }
  }
  const doRename = async (id: string, title: string) => {
    setConvs((c) => c.map((x) => (x.id === id ? { ...x, title } : x)))
    try { await data('conv.rename', { id, title }) } catch { flash('Não foi possível renomear.'); refreshList() }
  }
  const doPin = async (id: string, pinned: boolean) => {
    setConvs((c) => c.map((x) => (x.id === id ? { ...x, pinned } : x)))
    try { await data('conv.pin', { id, pinned }) } catch { flash('Não foi possível fixar.'); refreshList() }
  }

  const reloadAgents = useCallback(async () => {
    try { const j = await data('agent.list'); setAgents(j.agents) } catch { /* ignora */ }
  }, [])
  const doAgent = async (agentId: string | null) => {
    if (!activeRef.current) { setNewAgent(agentId); return } // conversa nova: vale a partir da primeira mensagem
    const id = activeRef.current
    setConvs((c) => c.map((x) => (x.id === id ? { ...x, agent_id: agentId } : x)))
    try {
      const j = await data('conv.set_agent', { id, agent_id: agentId })
      // aplica o estado confirmado pelo servidor (uma listagem antiga que chegou depois não desfaz a troca)
      if (j.conversation) setConvs((c) => c.map((x) => (x.id === id ? { ...x, agent_id: j.conversation.agent_id } : x)))
    } catch { flash('Não foi possível trocar o agente.'); refreshList() }
  }

  /** Nota → chat: abre uma conversa NOVA e envia o texto (ex.: "melhorar redação"). */
  const startChatWith = (text: string) => {
    if (streamRef.current) { flash('Aguarde a resposta atual terminar.'); return }
    setNewAgent(null)
    activeRef.current = null
    setMessages([])
    location.hash = '#/chat'
    setRoute({ view: 'chat', id: null })
    run('send', text)
  }

  const conversation = convs.find((c) => c.id === activeId) ?? null
  const currentAgentId = conversation ? conversation.agent_id ?? null : newAgent
  const tab = (v: 'notes' | 'chat', label: string, icon: string) => (
    <button data-testid={`tab-${v}`} aria-current={view === v ? 'page' : undefined}
      onClick={() => { location.hash = v === 'notes' ? (lastNote.current ? `#/n/${lastNote.current}` : '#/') : (lastChat.current ? `#/c/${lastChat.current}` : '#/chat') }}
      className={`flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${view === v ? 'bg-indigo-600 text-white' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}>
      <span aria-hidden>{icon}</span>{label}
    </button>
  )

  return (
    <div className="h-screen-dvh flex flex-col overflow-hidden">
      <nav className="pt-safe pl-safe pr-safe flex items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950" data-testid="topnav">
        {view === 'chat' && <button onClick={() => setMenuOpen(true)} aria-label="Abrir conversas" data-testid="menu-btn" className="h-10 w-10 rounded-lg text-xl hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800">☰</button>}
        {tab('notes', 'Notas', '📝')}
        {tab('chat', 'Chat IA', '💬')}
        <span className="ml-auto hidden px-2 text-xs font-medium text-zinc-400 sm:inline">Anotação Médica</span>
        <button data-testid="settings-btn" onClick={() => setSettings('appearance')} aria-label="Ajustes" title="Ajustes" className="h-10 rounded-lg px-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">⚙️<span className="ml-1 hidden sm:inline">Ajustes</span></button>
        <button data-testid="logout-btn" onClick={async () => { await auth.logout() }} className="h-10 rounded-lg px-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">Sair</button>
      </nav>
      <div className="flex min-h-0 flex-1">
        {view === 'notes' ? (
          <NotesView noteId={route.id} onSelect={goNote} onAskAI={startChatWith} flash={flash} />
        ) : (
          <>
            <Sidebar conversations={convs} activeId={activeId} open={menuOpen} onClose={() => setMenuOpen(false)}
              onNew={() => { setNewAgent(null); go(null) }} onSelect={go} onRename={doRename} onPin={doPin} onDelete={doDelete} />
            <ChatView conversation={conversation} messages={messages} loading={loading} stream={stream} error={error}
              model={prefs.default_model} catalog={catalog} lang={prefs.language}
              onModel={(v) => updatePrefs({ default_model: v })} onLoadCatalog={loadCatalog}
              onSend={(t) => run('send', t)} onStop={() => streamRef.current?.ctrl.abort()}
              onRegenerate={() => run('regenerate')} onContinue={() => run('continue')} onMenu={() => setMenuOpen(true)}
              agents={agents} agentId={currentAgentId} onAgent={doAgent} onManageAgents={() => setSettings('agents')} />
          </>
        )}
      </div>
      {settings && <SettingsModal prefs={prefs} onPrefs={updatePrefs} onClose={() => setSettings(null)} onLoggedOut={loggedOut} initialTab={settings}
        agents={agents} onAgents={setAgents} onAgentsChanged={() => { reloadAgents(); refreshList() }} skills={skills} onSkills={setSkills} />}
      {toast && <div role="status" data-testid="toast" className="pb-safe fixed bottom-20 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
    </div>
  )
}
