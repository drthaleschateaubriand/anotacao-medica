// Validação de AGENTES, SKILLS e NOTAS. Módulo puro (sem Deno/Supabase) para poder ser testado com vitest.
import { ValidationError, cleanModelPref, cleanText } from "./text.ts";

export { ValidationError as AgentValidationError, ValidationError };

export const AGENT_LIMITS = { name: 60, description: 200, instructions: 4000, emoji: 8, perUser: 50, skillsPerAgent: 10 } as const;
export const SKILL_LIMITS = { name: 60, description: 200, instructions: 4000, perUser: 50, globalMax: 10 } as const;
export const NOTE_LIMITS = { title: 200, content: 100_000, perUser: 2000 } as const;

export interface AgentInput { name: string; description: string; instructions: string; emoji: string | null; preferred_model: string }
export interface SkillInput { name: string; description: string; instructions: string; preferred_model: string; is_global: boolean }
export interface NoteInput { title?: string; content?: string; pinned?: boolean }

/** Valida e normaliza o corpo de agent.create/agent.update. */
export function validateAgentInput(b: Record<string, unknown>): AgentInput {
  const name = cleanText(b.name, "o nome", AGENT_LIMITS.name, true);
  const description = cleanText(b.description, "a descrição", AGENT_LIMITS.description, false).replace(/\s+/g, " ");
  const instructions = cleanText(b.instructions, "as instruções", AGENT_LIMITS.instructions, true);
  const emojiRaw = cleanText(b.emoji, "o emoji", 32, false);
  if ([...emojiRaw].length > 4 || emojiRaw.length > AGENT_LIMITS.emoji) throw new ValidationError("Emoji/ícone: use no máximo 1 a 4 símbolos.");
  return { name: name.replace(/\s+/g, " "), description, instructions, emoji: emojiRaw || null, preferred_model: cleanModelPref(b.preferred_model) };
}

export function validateSkillInput(b: Record<string, unknown>): SkillInput {
  return {
    name: cleanText(b.name, "o nome", SKILL_LIMITS.name, true).replace(/\s+/g, " "),
    description: cleanText(b.description, "a descrição", SKILL_LIMITS.description, false).replace(/\s+/g, " "),
    instructions: cleanText(b.instructions, "as instruções", SKILL_LIMITS.instructions, true),
    preferred_model: cleanModelPref(b.preferred_model),
    is_global: b.is_global === true,
  };
}

/** Nota: título e texto livre (espaços e quebras de linha do texto são preservados). Campos ausentes não são alterados. */
export function validateNoteInput(b: Record<string, unknown>): NoteInput {
  const out: NoteInput = {};
  if (b.title !== undefined) out.title = cleanText(b.title, "o título", NOTE_LIMITS.title, false).replace(/\s+/g, " ");
  if (b.content !== undefined) out.content = cleanText(b.content, "o texto", NOTE_LIMITS.content, false, false);
  if (b.pinned !== undefined) out.pinned = b.pinned === true;
  return out;
}
