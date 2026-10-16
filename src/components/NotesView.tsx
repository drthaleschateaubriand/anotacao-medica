import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note, NoteMeta } from '../types'
import { ApiError, data } from '../services/api'
import { download } from '../lib/exporters'
import { AI_ACTIONS, aiPrompt, noteDisplayTitle, noteFileName, noteToText, sortNotes } from '../lib/notes'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
const AUTOSAVE_MS = 800

interface Draft { id: string | null; title: string; content: string; pinned: boolean; updated_at: string | null }
const EMPTY: Draft = { id: null, title: '', content: '', pinned: false, updated_at: null }

function when(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Bloco de notas: lista + editor grande com salvamento automático, busca, fixar, copiar, baixar .txt e enviar à IA. */
export function NotesView({ noteId, onSelect, onAskAI, flash }: {
  noteId: string | null
  onSelect: (id: string | null) => void
  onAskAI: (text: string) => void
  flash: (m: string) => void
}) {
  const [list, setList] = useState<NoteMeta[] | null>(null)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [save, setSave] = useState<SaveState>('idle')
  const [loading, setLoading] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(!!noteId)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const inflight = useRef<Promise<void> | null>(null)
  const qRef = useRef(q)
  qRef.current = q
  const autoOpened = useRef(false)
  const cb = useRef({ onSelect, flash })
  cb.current = { onSelect, flash }
  const flushRef = useRef<() => Promise<void>>(async () => {})

  const loadList = useCallback(async () => {
    try { setList((await data('note.list', { q: qRef.current.trim() })).notes) } catch { /* offline: tenta depois */ }
  }, [])

  // busca com atraso
  useEffect(() => { const t = setTimeout(loadList, q ? 300 : 0); return () => clearTimeout(t) }, [q, loadList])

  // sincroniza entre dispositivos: ao focar, ao voltar online e a cada 20 s (se não houver edição pendente)
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') { loadList(); refreshOpen() } }
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    window.addEventListener('online', tick)
    const t = setInterval(tick, 20000)
    return () => { document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); window.removeEventListener('online', tick); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList])

  /** Se outro dispositivo alterou a nota aberta e aqui não há edição pendente, mostra a versão nova. */
  async function refreshOpen() {
    const d = draftRef.current
    if (!d.id || dirty.current || inflight.current) return
    try {
      const { note } = await data('note.get', { id: d.id }) as { note: Note }
      if (!dirty.current && draftRef.current.id === note.id && note.updated_at !== draftRef.current.updated_at) setDraft({ id: note.id, title: note.title, content: note.content, pinned: note.pinned, updated_at: note.updated_at })
    } catch (e) { if (e instanceof ApiError && e.status === 404) { setDraft(EMPTY); cb.current.onSelect(null) } }
  }

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    if (inflight.current) await inflight.current
    if (!dirty.current) return
    const run = async () => {
      const d = draftRef.current
      if (!d.id && !d.title.trim() && !d.content.trim()) { dirty.current = false; setSave('idle'); return }
      dirty.current = false
      setSave('saving')
      try {
        if (!d.id) {
          const { note } = await data('note.create', { title: d.title, content: d.content, pinned: d.pinned }) as { note: Note }
          // o texto pode ter mudado durante a gravação: mantém o que está na tela e só adota id/versão
          setDraft((cur) => ({ ...cur, id: note.id, updated_at: note.updated_at }))
          draftRef.current = { ...draftRef.current, id: note.id, updated_at: note.updated_at }
          cb.current.onSelect(note.id)
        } else {
          const { note } = await data('note.update', { id: d.id, title: d.title, content: d.content, pinned: d.pinned, base_updated_at: d.updated_at }) as { note: Note }
          setDraft((cur) => (cur.id === note.id ? { ...cur, updated_at: note.updated_at } : cur))
          draftRef.current = { ...draftRef.current, updated_at: note.updated_at }
        }
        setSave(dirty.current ? 'dirty' : 'saved')
        loadList()
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // outro dispositivo salvou antes: NADA se perde — o texto daqui vira uma nota "(conflito)" e a versão do servidor é mostrada
          try {
            await data('note.create', { title: `${d.title || 'Nota'} (conflito ${new Date().toLocaleTimeString('pt-BR')})`, content: d.content })
            cb.current.flash('Esta nota foi alterada em outro dispositivo. Seu texto foi guardado numa nota separada "(conflito)".')
          } catch { /* ignora */ }
          const note = (e as ApiError).extra?.note as Note | undefined
          if (note) setDraft({ id: note.id, title: note.title, content: note.content, pinned: note.pinned, updated_at: note.updated_at })
          else if (d.id) await openNote(d.id)
          setSave('saved'); loadList()
        } else {
          dirty.current = true
          setSave('error')
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => { flush() }, 5000) // tenta de novo
        }
      }
    }
    inflight.current = run().finally(() => { inflight.current = null })
    await inflight.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList])
  flushRef.current = flush

  const schedule = () => {
    dirty.current = true
    setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { flush() }, AUTOSAVE_MS)
  }

  // salva ao esconder a aba/fechar
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'hidden' && dirty.current) flush() }
    document.addEventListener('visibilitychange', h)
    window.addEventListener('pagehide', h)
    return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('pagehide', h) }
  }, [flush])
  useEffect(() => () => { if (dirty.current) flushRef.current() }, []) // ao sair da tela de notas, grava o que faltar

  const openNote = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const { note } = await data('note.get', { id }) as { note: Note }
      setDraft({ id: note.id, title: note.title, content: note.content, pinned: note.pinned, updated_at: note.updated_at })
      setSave('idle'); dirty.current = false
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { setDraft(EMPTY); cb.current.onSelect(null) } else cb.current.flash('Não foi possível abrir a nota.')
    } finally { setLoading(false) }
  }, [])

  // abre a nota indicada na URL (#/n/<id>)
  useEffect(() => {
    if (noteId && noteId !== draftRef.current.id) { flush().then(() => openNote(noteId)); setMobileEditor(true) }
    if (!noteId && draftRef.current.id) { setDraft(EMPTY); setSave('idle') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  // no computador, abre a primeira nota automaticamente se nada estiver aberto
  useEffect(() => {
    if (autoOpened.current || !list) return
    autoOpened.current = true
    if (!noteId && list.length && !q && window.matchMedia('(min-width: 768px)').matches) onSelect(sortNotes(list)[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])

  const newNote = async () => {
    await flush()
    setDraft(EMPTY); setSave('idle'); dirty.current = false
    onSelect(null)
    setMobileEditor(true)
    setTimeout(() => document.getElementById('note-title')?.focus(), 50)
  }
  const select = async (id: string) => { await flush(); onSelect(id); setMobileEditor(true) }
  const togglePin = async () => {
    const d = draftRef.current
    if (!d.id) { setDraft({ ...d, pinned: !d.pinned }); schedule(); return }
    setDraft({ ...d, pinned: !d.pinned }); schedule()
  }
  const remove = async () => {
    const d = draftRef.current
    if (!d.id) { setDraft(EMPTY); setSave('idle'); dirty.current = false; setMobileEditor(false); return }
    if (!confirm('Excluir esta nota para sempre?')) return
    window.clearTimeout(timer.current); dirty.current = false
    try { await data('note.delete', { id: d.id }); setDraft(EMPTY); setSave('idle'); onSelect(null); setMobileEditor(false); loadList() } catch { flash('Não foi possível excluir a nota.') }
  }
  const copy = async () => {
    const d = draftRef.current
    try { await navigator.clipboard.writeText(d.content); flash('Texto copiado.') } catch {
      const ta = document.getElementById('note-body') as HTMLTextAreaElement | null
      if (ta) { ta.select(); document.execCommand('copy'); flash('Texto copiado.') }
    }
  }
  const askAI = async (instruction: string) => {
    setAiOpen(false)
    const d = draftRef.current
    if (!d.content.trim() && !d.title.trim()) { flash('Escreva algo na nota primeiro.'); return }
    await flush()
    onAskAI(aiPrompt(instruction, d.title, d.content))
  }

  const status: Record<SaveState, string> = { idle: '', dirty: 'Editando…', saving: 'Salvando…', saved: 'Salvo ✓', error: 'Sem conexão: tentando salvar de novo…' }

  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="notes-view">
      {/* lista */}
      <aside data-testid="notes-list" className={`${mobileEditor ? 'hidden' : 'flex'} min-h-0 w-full flex-col border-r border-zinc-200 bg-zinc-50 md:flex md:w-80 md:shrink-0 dark:border-zinc-800 dark:bg-zinc-900`}>
        <div className="space-y-2 p-3">
          <button data-testid="note-new" onClick={newNote} className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">＋ Nova nota</button>
          <input data-testid="note-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar nas notas…"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
        </div>
        <nav className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {list === null && <p className="p-3 text-sm text-zinc-500">Carregando…</p>}
          {list && !list.length && <p className="p-3 text-sm text-zinc-500">{q ? 'Nada encontrado.' : 'Nenhuma nota ainda. Toque em “Nova nota”.'}</p>}
          {list && sortNotes(list).map((n) => (
            <button key={n.id} data-testid="note-item" onClick={() => select(n.id)} className={`block w-full rounded-lg px-3 py-2.5 text-left ${draft.id === n.id ? 'bg-zinc-200 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'}`}>
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.pinned && '📌 '}{noteDisplayTitle(n)}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">{when(n.updated_at)}</span>
              </div>
              <div className="truncate text-xs text-zinc-500">{n.snippet || 'Nota vazia'}</div>
            </button>
          ))}
        </nav>
      </aside>

      {/* editor */}
      <section className={`${mobileEditor ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col md:flex`} data-testid="note-editor">
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
          <button aria-label="Voltar à lista" data-testid="note-back" onClick={async () => { await flush(); setMobileEditor(false) }} className="h-10 rounded-lg px-3 text-sm hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800">← Notas</button>
          <span data-testid="note-status" aria-live="polite" className={`px-1 text-xs ${save === 'error' ? 'text-red-600' : 'text-zinc-500'}`}>{status[save]}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <button data-testid="note-pin" title={draft.pinned ? 'Desafixar' : 'Fixar no topo'} aria-pressed={draft.pinned} onClick={togglePin} className={`h-10 w-10 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 ${draft.pinned ? 'bg-amber-100 dark:bg-amber-950' : ''}`}>📌</button>
            <button data-testid="note-copy" title="Copiar texto" onClick={copy} className="h-10 w-10 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">📋</button>
            <button data-testid="note-download" title="Baixar .txt" onClick={() => download(noteFileName(draft.title || draft.content.split('\n')[0] || 'nota'), noteToText(draft.title, draft.content))} className="h-10 w-10 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">⤓</button>
            <div className="relative">
              <button data-testid="note-ai" onClick={() => setAiOpen(!aiOpen)} className="h-10 rounded-lg px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950">✨ IA ▾</button>
              {aiOpen && (
                <div data-testid="note-ai-menu" className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                  {AI_ACTIONS.map((a) => <button key={a.id} data-testid={`note-ai-${a.id}`} onClick={() => askAI(a.prompt)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">{a.label}</button>)}
                  <p className="px-3 pb-1 pt-1 text-[11px] text-zinc-500">Envia o texto desta nota ao chat. Evite dados que identifiquem pacientes.</p>
                </div>
              )}
            </div>
            <button data-testid="note-delete" title="Excluir nota" onClick={remove} className="h-10 w-10 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950">🗑️</button>
          </div>
        </div>
        <input id="note-title" data-testid="note-title" value={draft.title} maxLength={200} placeholder="Título (opcional)" aria-label="Título da nota"
          onChange={(e) => { setDraft({ ...draft, title: e.target.value }); schedule() }}
          className="w-full bg-transparent px-4 pb-1 pt-3 text-xl font-semibold outline-none placeholder:text-zinc-400 md:px-8" />
        <textarea id="note-body" data-testid="note-body" value={draft.content} maxLength={100000} aria-label="Texto da nota" disabled={loading}
          placeholder="Escreva aqui. Salva automaticamente."
          onChange={(e) => { setDraft({ ...draft, content: e.target.value }); schedule() }}
          className="scroll-thin min-h-0 w-full flex-1 resize-none bg-transparent px-4 py-2 text-base leading-relaxed outline-none placeholder:text-zinc-400 md:px-8" />
        <div className="pb-safe flex flex-wrap items-center justify-between gap-x-3 border-t border-zinc-200 px-4 py-1 text-[11px] text-zinc-400 dark:border-zinc-800">
          <span>{draft.content.length.toLocaleString('pt-BR')} caracteres</span>
          <span>Não digite dados que identifiquem pacientes (nome, CPF, prontuário).</span>
        </div>
      </section>
    </div>
  )
}
