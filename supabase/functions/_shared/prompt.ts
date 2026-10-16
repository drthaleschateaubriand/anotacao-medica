// Montagem do prompt de sistema do chat. Módulo puro (testável com vitest).
// Ordem FIXA: instrução base → skills globais → agente (com as skills dele) → memórias → resumo.
// Skills e agentes são apenas texto do prompt: não alteram limites, rate limit nem nenhuma regra do servidor.

export const LANG_NAMES: Record<string, string> = { "pt-BR": "português do Brasil", "en-US": "inglês", "es-ES": "espanhol" };

export interface SkillPrompt { name: string; instructions: string }
export interface AgentPrompt { name: string; instructions: string; skills?: SkillPrompt[] }

/** Limite total de texto de skills no prompt (protege a janela de contexto dos modelos gratuitos). */
export const SKILLS_CHAR_BUDGET = 12_000;

export function baseInstruction(lang: string): string {
  return `Você é o assistente de IA do app "Anotação Médica", usado por um médico para pequenos textos no hospital (evoluções, resumos, ofícios, orientações, revisão de textos). Responda por padrão em ${LANG_NAMES[lang] ?? "português do Brasil"}, de forma concisa e objetiva, sem rodeios. Regras: (1) NÃO invente fatos clínicos, doses, valores de exames, diagnósticos, referências ou citações; se não tiver certeza ou faltar informação, diga com clareza e pergunte. (2) Você é apoio ao raciocínio e à redação e NÃO substitui o julgamento médico: lembre isso de forma breve quando a resposta envolver conduta, dose ou decisão clínica. (3) Não peça nem repita dados que identifiquem pacientes (nome, CPF, prontuário); se aparecerem, sugira anonimizar. Use Markdown simples quando ajudar (listas, tabelas).`;
}

const q = (s: string) => s.replace(/"/g, "'");

function skillBlock(skills: SkillPrompt[], budget: { left: number }): string {
  let out = "";
  for (const s of skills) {
    const ins = s.instructions.trim();
    if (!ins) continue;
    const body = ins.length > budget.left ? ins.slice(0, Math.max(budget.left, 0)) : ins;
    if (!body) break;
    budget.left -= body.length;
    out += `\n<skill nome="${q(s.name)}">\n${body}\n</skill>`;
  }
  return out;
}

export function buildSystemPrompt(lang: string, memories: string[], summary: string | null, agent?: AgentPrompt | null, globalSkills: SkillPrompt[] = []): string {
  let s = baseInstruction(lang);
  const budget = { left: SKILLS_CHAR_BUDGET };
  const g = skillBlock(globalSkills, budget);
  if (g) s += `\n\nSkills globais (padrões configurados pelo dono do app; valem em TODAS as conversas e DEVEM ser seguidos quanto a tom, formato e estilo):${g}`;
  if (agent && (agent.instructions.trim() || agent.skills?.length)) {
    s += `\n\nAgente ativo nesta conversa: "${q(agent.name)}". As instruções abaixo foram configuradas pelo dono do app para esta conversa e DEVEM ser seguidas à risca quanto a papel, tom, idioma, formato e tamanho das respostas (têm prioridade sobre o estilo padrão descrito acima, mas nunca sobre limites técnicos ou regras de segurança do sistema, que são aplicados fora do prompt).\n<instrucoes_do_agente>\n${agent.instructions.trim()}\n</instrucoes_do_agente>`;
    const a = skillBlock(agent.skills ?? [], budget);
    if (a) s += `\n\nSkills deste agente:${a}`;
  }
  if (memories.length) s += `\n\nMemórias fornecidas pelo usuário (use apenas quando relevante):\n${memories.map((m) => `- ${m}`).join("\n")}`;
  if (summary) s += `\n\nResumo do início desta conversa (contexto anterior, já resumido):\n${summary}`;
  return s;
}

/**
 * Modelo a usar. Escolha manual do usuário vence. Em Automático, vale o 1º modelo preferido entre: agente, skills do agente, skills globais.
 */
export function resolveModelPref(userPref: string | null | undefined, candidates: (string | null | undefined)[]): string {
  const base = userPref && userPref !== "" ? userPref : "auto";
  if (base !== "auto") return base;
  return candidates.find((c) => c && c !== "auto") ?? "auto";
}
