import type { Agent } from '../types'

export const AGENT_LIMITS = { name: 60, description: 200, instructions: 4000, emoji: 8, perUser: 50, skillsPerAgent: 10 } as const

export interface AgentDraft { name: string; description: string; instructions: string; emoji: string; preferred_model: string }

/** Validação no cliente (o servidor valida de novo). Devolve mensagens por campo. */
export function validateDraft(d: AgentDraft): Partial<Record<keyof AgentDraft, string>> {
  const e: Partial<Record<keyof AgentDraft, string>> = {}
  if (!d.name.trim()) e.name = 'Dê um nome ao agente.'
  else if (d.name.trim().length > AGENT_LIMITS.name) e.name = `Máximo de ${AGENT_LIMITS.name} caracteres.`
  if (d.description.length > AGENT_LIMITS.description) e.description = `Máximo de ${AGENT_LIMITS.description} caracteres.`
  if (!d.instructions.trim()) e.instructions = 'Escreva as instruções do agente.'
  else if (d.instructions.length > AGENT_LIMITS.instructions) e.instructions = `Máximo de ${AGENT_LIMITS.instructions} caracteres.`
  if ([...d.emoji].length > 4) e.emoji = 'Use no máximo 4 símbolos.'
  return e
}

export function draftOf(a?: Agent | null): AgentDraft {
  return { name: a?.name ?? '', description: a?.description ?? '', instructions: a?.instructions ?? '', emoji: a?.emoji ?? '', preferred_model: a?.preferred_model ?? 'auto' }
}

/** Exemplos opcionais (só são criados quando o usuário clica em "Adicionar exemplos"). */
export const EXAMPLE_AGENTS: AgentDraft[] = [
  {
    name: 'Revisor de texto', emoji: '✍️', preferred_model: 'auto',
    description: 'Corrige gramática e clareza e lista as mudanças.',
    instructions: 'Você é um revisor de textos em português do Brasil. Para cada texto recebido: 1) apresente a versão corrigida (ortografia, gramática, pontuação, clareza e concisão), mantendo a voz e o sentido do autor; 2) liste em tópicos curtos as principais mudanças e o porquê. Não reescreva o conteúdo além do necessário e NÃO acrescente fatos, doses ou valores.',
  },
  {
    name: 'Resumo de evolução', emoji: '🩺', preferred_model: 'auto',
    description: 'Resume um relato em poucas linhas objetivas.',
    instructions: 'Você resume textos clínicos fornecidos pelo usuário em até 6 linhas objetivas, na ordem: queixa/situação, achados informados, conduta informada, pendências. Use somente o que está no texto; marque "[não informado]" quando faltar algo. Não faça diagnóstico nem sugira conduta, a menos que o usuário peça explicitamente (e, então, lembre que é apoio e não substitui o julgamento médico).',
  },
  {
    name: 'Tradutor PT-EN', emoji: '🌐', preferred_model: 'auto',
    description: 'Traduz entre português e inglês, só com a tradução.',
    instructions: 'Você é um tradutor profissional português↔inglês. Se o texto do usuário estiver em português, traduza para inglês; se estiver em inglês, traduza para português do Brasil. Responda SOMENTE com a tradução, sem comentários ou aspas. Preserve tom, formatação, siglas e termos técnicos.',
  },
]
