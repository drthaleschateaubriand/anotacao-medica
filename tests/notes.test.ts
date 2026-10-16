import { describe, expect, it } from 'vitest'
import { AI_ACTIONS, aiPrompt, noteDisplayTitle, noteFileName, noteToText, sortNotes } from '../src/lib/notes.ts'

describe('notas (utilitários)', () => {
  it('título exibido: título, senão primeira linha, senão "Sem título"', () => {
    expect(noteDisplayTitle({ title: ' Plantão ', snippet: 'x' })).toBe('Plantão')
    expect(noteDisplayTitle({ title: '', snippet: '\n  Primeira linha  \nsegunda' })).toBe('Primeira linha')
    expect(noteDisplayTitle({ title: '', snippet: '' })).toBe('Sem título')
  })
  it('nome de arquivo .txt e conteúdo', () => {
    expect(noteFileName('Evolução: leito 3/UTI!')).toBe('Evolução-leito-3UTI.txt')
    expect(noteFileName('???')).toBe('nota.txt')
    expect(noteToText('Título', 'corpo')).toBe('Título\n======\n\ncorpo')
    expect(noteToText('', 'corpo')).toBe('corpo')
  })
  it('fixadas primeiro, depois mais recentes', () => {
    const mk = (id: string, pinned: boolean, d: string) => ({ id, title: id, snippet: '', pinned, chars: 0, created_at: d, updated_at: d })
    expect(sortNotes([mk('a', false, '2026-01-02'), mk('b', true, '2026-01-01'), mk('c', false, '2026-01-03')]).map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })
  it('prompts de IA não inventam fatos e incluem o texto', () => {
    expect(AI_ACTIONS.map((a) => a.id)).toEqual(['improve', 'summarize', 'fix', 'organize'])
    expect(AI_ACTIONS[0].prompt).toMatch(/SEM acrescentar fatos/)
    expect(aiPrompt('Resuma.', 'T', 'corpo')).toBe('Resuma.\n\n"""\nT\n\ncorpo\n"""')
  })
})
