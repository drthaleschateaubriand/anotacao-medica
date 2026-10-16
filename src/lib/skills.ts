import type { Skill } from '../types'

export const SKILL_LIMITS = { name: 60, description: 200, instructions: 4000, perUser: 50, globalMax: 10 } as const

export interface SkillDraft { name: string; description: string; instructions: string; preferred_model: string; is_global: boolean }

export function skillDraftOf(s?: Skill | null): SkillDraft {
  return { name: s?.name ?? '', description: s?.description ?? '', instructions: s?.instructions ?? '', preferred_model: s?.preferred_model ?? 'auto', is_global: s?.is_global ?? false }
}

export function validateSkillDraft(d: SkillDraft): Partial<Record<keyof SkillDraft, string>> {
  const e: Partial<Record<keyof SkillDraft, string>> = {}
  if (!d.name.trim()) e.name = 'Dê um nome à skill.'
  else if (d.name.trim().length > SKILL_LIMITS.name) e.name = `Máximo de ${SKILL_LIMITS.name} caracteres.`
  if (d.description.length > SKILL_LIMITS.description) e.description = `Máximo de ${SKILL_LIMITS.description} caracteres.`
  if (!d.instructions.trim()) e.instructions = 'Escreva as instruções da skill.'
  else if (d.instructions.length > SKILL_LIMITS.instructions) e.instructions = `Máximo de ${SKILL_LIMITS.instructions} caracteres.`
  return e
}

/** Exemplos opcionais (só são criados quando o usuário clica em "Adicionar exemplos"). */
export const EXAMPLE_SKILLS: SkillDraft[] = [
  {
    name: 'Texto clínico conciso', description: 'Frases curtas, tópicos, sem floreio e sem inventar dados.', preferred_model: 'auto', is_global: false,
    instructions: 'Escreva de forma clínica, objetiva e concisa: frases curtas, voz ativa, tópicos quando houver mais de dois itens. Use apenas as informações fornecidas pelo usuário; se faltar dado (idade, dose, data, resultado), sinalize como "[não informado]" em vez de supor. Use abreviações médicas usuais do Brasil apenas quando forem inequívocas.',
  },
  {
    name: 'Formato SOAP', description: 'Organiza o texto em Subjetivo, Objetivo, Avaliação e Plano.', preferred_model: 'auto', is_global: false,
    instructions: 'Quando o usuário colar ou ditar um relato de atendimento, organize-o em quatro seções com estes títulos: **S (Subjetivo)**, **O (Objetivo)**, **A (Avaliação)** e **P (Plano)**. Coloque em cada seção somente o que o texto original traz, sem acrescentar achados, diagnósticos ou condutas novas. Se uma seção não tiver informação, escreva "não informado".',
  },
  {
    name: 'Tom formal (ofícios e relatórios)', description: 'Linguagem formal e respeitosa para documentos.', preferred_model: 'auto', is_global: false,
    instructions: 'Redija em português formal, claro e respeitoso, adequado a ofícios, relatórios e comunicações institucionais: sem gírias, sem excesso de adjetivos, parágrafos curtos. Mantenha fidelidade total aos fatos informados e não crie datas, números de protocolo ou nomes que não tenham sido fornecidos.',
  },
]
