import { useEffect, useState } from 'react'
import type { Agent, CatalogProvider, Skill } from '../types'
import { ApiError, data } from '../services/api'
import { EXAMPLE_SKILLS, SKILL_LIMITS, skillDraftOf, validateSkillDraft, type SkillDraft } from '../lib/skills'

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`text-xs tabular-nums ${n > max ? 'font-semibold text-red-600' : n > max * 0.9 ? 'text-amber-600' : 'text-zinc-500'}`}>{n}/{max}</span>
}

/** Skills: instruções/padrões reutilizáveis. Podem valer em TODAS as conversas (globais) e/ou ser anexadas a agentes. */
export function SkillsTab({ skills, onSkills, onAgents }: {
  skills: Skill[]
  onSkills: (list: Skill[]) => void
  onAgents: (list: Agent[]) => void
}) {
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [draft, setDraft] = useState<SkillDraft>(skillDraftOf(null))
  const [errors, setErrors] = useState<Partial<Record<keyof SkillDraft, string>>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [cat, setCat] = useState<CatalogProvider[] | null>(null)
  useEffect(() => { data('models.list').then((j) => setCat(j.catalog)).catch(() => setCat([])) }, [])

  const reload = async () => { const j = await data('skill.list'); onSkills(j.skills) }
  const reloadAgents = async () => { const j = await data('agent.list'); onAgents(j.agents) }
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? e.message : 'Não foi possível concluir. Verifique a conexão.')
  const start = (s?: Skill) => { setEditing(s ? s.id : 'new'); setDraft(skillDraftOf(s)); setErrors({}); setMsg('') }
  const patch = (p: Partial<SkillDraft>) => { setDraft((d) => ({ ...d, ...p })); setErrors({}) }

  const save = async () => {
    const e = validateSkillDraft(draft)
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true); setMsg('')
    try {
      const body = { ...draft, name: draft.name.trim() }
      if (editing === 'new') await data('skill.create', body)
      else await data('skill.update', { ...body, id: editing })
      await reload(); setEditing(null)
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const toggleGlobal = async (s: Skill) => {
    setBusy(true); setMsg('')
    try { await data('skill.update', { id: s.id, name: s.name, description: s.description, instructions: s.instructions, preferred_model: s.preferred_model, is_global: !s.is_global }); await reload() } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const duplicate = async (s: Skill) => { setBusy(true); setMsg(''); try { await data('skill.duplicate', { id: s.id }); await reload() } catch (e) { fail(e) } finally { setBusy(false) } }
  const remove = async (s: Skill) => { setBusy(true); setMsg(''); try { await data('skill.delete', { id: s.id }); setConfirmDel(null); await reload(); await reloadAgents() } catch (e) { fail(e) } finally { setBusy(false) } }
  const addExamples = async () => {
    setBusy(true); setMsg('')
    try {
      const have = new Set(skills.map((s) => s.name.toLowerCase()))
      let n = 0
      for (const ex of EXAMPLE_SKILLS) { if (have.has(ex.name.toLowerCase())) continue; await data('skill.create', { ...ex }); n++ }
      await reload()
      setMsg(n ? `${n} exemplo${n > 1 ? 's' : ''} adicionado${n > 1 ? 's' : ''}.` : 'Os exemplos já estão na sua lista.')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const modelOptions = (cat ?? []).filter((p) => p.configured).flatMap((p) => p.models.map((m) => ({ v: `${m.provider}|${m.id}`, l: `${p.name.replace(/ \(.*$/, '')} · ${m.label}` })))
  if (draft.preferred_model !== 'auto' && !modelOptions.some((o) => o.v === draft.preferred_model)) modelOptions.push({ v: draft.preferred_model, l: draft.preferred_model })

  if (editing) {
    const field = 'w-full rounded-lg border bg-white px-3 py-2 dark:bg-zinc-950'
    const border = (k: keyof SkillDraft) => (errors[k] ? 'border-red-500' : 'border-zinc-300 dark:border-zinc-700')
    return (
      <div className="space-y-3" data-testid="skill-form">
        <h3 className="text-base font-semibold">{editing === 'new' ? 'Nova skill' : 'Editar skill'}</h3>
        <label className="block"><span className="mb-1 flex justify-between font-medium">Nome <Counter n={draft.name.length} max={SKILL_LIMITS.name} /></span>
          <input data-testid="skill-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Ex.: Texto clínico conciso" className={`${field} ${border('name')}`} />
        </label>
        {errors.name && <p role="alert" className="text-xs text-red-600">{errors.name}</p>}
        <label className="block"><span className="mb-1 flex justify-between font-medium">Descrição curta <Counter n={draft.description.length} max={SKILL_LIMITS.description} /></span>
          <input data-testid="skill-desc" value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Opcional" className={`${field} ${border('description')}`} />
        </label>
        <label className="block"><span className="mb-1 flex justify-between font-medium">Instruções <Counter n={draft.instructions.length} max={SKILL_LIMITS.instructions} /></span>
          <textarea data-testid="skill-instructions" rows={9} value={draft.instructions} onChange={(e) => patch({ instructions: e.target.value })} placeholder="Descreva o padrão que a IA deve seguir sempre (tom, formato, regras)…" className={`${field} ${border('instructions')}`} />
        </label>
        {errors.instructions && <p role="alert" className="text-xs text-red-600">{errors.instructions}</p>}
        <label className="block"><span className="mb-1 block font-medium">Modelo preferido (opcional)</span>
          <select data-testid="skill-model" value={draft.preferred_model} onChange={(e) => patch({ preferred_model: e.target.value })} className={`${field} ${border('preferred_model')}`}>
            <option value="auto">Automático (recomendado)</option>
            {modelOptions.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <span className="mt-1 block text-xs text-zinc-500">Só vale com o modelo da conversa em Automático.</span>
        </label>
        <label className="flex items-start gap-2"><input data-testid="skill-global" type="checkbox" className="mt-0.5 h-5 w-5" checked={draft.is_global} onChange={(e) => patch({ is_global: e.target.checked })} />
          <span><b>Ativar em todas as conversas</b> (skill global). Sem isso, a skill só vale nos agentes aos quais você a anexar (máx. {SKILL_LIMITS.globalMax} globais).</span></label>
        {msg && <p role="alert" className="rounded-md bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{msg}</p>}
        <div className="flex gap-2">
          <button data-testid="skill-save" disabled={busy} onClick={save} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
          <button onClick={() => { setEditing(null); setErrors({}); setMsg('') }} className="rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700">Cancelar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="skills-tab">
      <p className="text-zinc-600 dark:text-zinc-400">Skills são <b>padrões reutilizáveis</b> que a IA segue sempre (ex.: “texto clínico conciso”, “formato SOAP”). Ordem no prompt: instrução base → <b>skills globais</b> → <b>agente</b> (com as skills dele) → memórias → resumo. Para anexar uma skill a um agente, edite o agente.</p>
      <div className="flex flex-wrap gap-2">
        <button data-testid="skill-new" onClick={() => start()} disabled={skills.length >= SKILL_LIMITS.perUser} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">＋ Nova skill</button>
        <button data-testid="skill-examples" disabled={busy} onClick={addExamples} className="rounded-lg border border-zinc-300 px-4 py-2 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Adicionar exemplos</button>
      </div>
      {msg && <p role="status" className="rounded-md bg-zinc-100 p-2 dark:bg-zinc-800">{msg}</p>}
      {!skills.length && <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-zinc-500 dark:border-zinc-700">Nenhuma skill ainda. Crie a sua ou adicione 3 exemplos.</p>}
      <ul className="space-y-2">
        {skills.map((s) => (
          <li key={s.id} data-testid={`skill-item-${s.id}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" data-testid="skill-item-name">🧩 {s.name} {s.is_global && <span className="ml-1 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">global</span>}</div>
                {s.description && <div className="text-xs text-zinc-500">{s.description}</div>}
                <div className="mt-0.5 text-[11px] text-zinc-400">{s.instructions.length} caracteres · modelo: {s.preferred_model === 'auto' ? 'Automático' : s.preferred_model.replace('|', ' · ')}</div>
              </div>
            </div>
            {confirmDel === s.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span>Excluir “{s.name}”? Ela também sai dos agentes.</span>
                <button data-testid="skill-del-confirm" disabled={busy} onClick={() => remove(s)} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white">Excluir</button>
                <button onClick={() => setConfirmDel(null)} className="rounded-lg px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <button data-testid="skill-toggle-global" disabled={busy} onClick={() => toggleGlobal(s)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">{s.is_global ? 'Desativar global' : 'Ativar global'}</button>
                <button data-testid="skill-edit" onClick={() => start(s)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Editar</button>
                <button data-testid="skill-dup" disabled={busy} onClick={() => duplicate(s)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Duplicar</button>
                <button data-testid="skill-del" onClick={() => setConfirmDel(s.id)} className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950">Excluir</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">{skills.length}/{SKILL_LIMITS.perUser} skills. Skills e agentes entram na exportação dos seus dados e são apenas texto do prompt: não mudam limites nem regras do servidor.</p>
    </div>
  )
}
