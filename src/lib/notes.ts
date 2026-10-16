import type { NoteMeta } from '../types'

/** Título exibido: o título da nota ou, se vazio, a primeira linha do texto. */
export function noteDisplayTitle(n: { title: string; snippet?: string; content?: string }): string {
  if (n.title.trim()) return n.title.trim()
  const first = ((n.content ?? n.snippet ?? '').split('\n').find((l) => l.trim()) ?? '').trim()
  return first ? first.slice(0, 80) : 'Sem título'
}

export function noteFileName(title: string): string {
  return (title.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'nota') + '.txt'
}

/** Conteúdo do .txt baixado: título (se houver) + texto. */
export function noteToText(title: string, content: string): string {
  return (title.trim() ? `${title.trim()}\n${'='.repeat(Math.min(60, title.trim().length))}\n\n` : '') + content
}

export const AI_ACTIONS: { id: string; label: string; prompt: string }[] = [
  { id: 'improve', label: '✨ Melhorar redação', prompt: 'Melhore a redação do texto abaixo (clareza, gramática e concisão), mantendo o sentido e SEM acrescentar fatos, doses ou valores que não estejam no texto. Responda só com a versão melhorada.' },
  { id: 'summarize', label: '📋 Resumir', prompt: 'Resuma o texto abaixo em poucos tópicos objetivos, sem acrescentar informações que não estejam nele.' },
  { id: 'fix', label: '🔤 Corrigir ortografia', prompt: 'Corrija apenas ortografia, acentuação e pontuação do texto abaixo, sem mudar o conteúdo nem o estilo. Responda só com o texto corrigido.' },
  { id: 'organize', label: '🗂️ Organizar em tópicos', prompt: 'Organize o texto abaixo em tópicos com títulos curtos, sem acrescentar nem remover informações.' },
]

export function aiPrompt(instruction: string, title: string, content: string): string {
  return `${instruction}\n\n"""\n${title.trim() ? title.trim() + '\n\n' : ''}${content}\n"""`
}

export function sortNotes(list: NoteMeta[]): NoteMeta[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.updated_at) - +new Date(a.updated_at))
}
