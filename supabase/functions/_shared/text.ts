// Validação de texto compartilhada (agentes, skills, notas). Módulo puro.
export class ValidationError extends Error {}

/** Remove caracteres de controle (exceto \n e \t), normaliza fins de linha e aplica limites. */
export function cleanText(v: unknown, field: string, max: number, required: boolean, trim = true): string {
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(`Campo obrigatório: ${field}.`);
    return "";
  }
  if (typeof v !== "string") throw new ValidationError(`Campo inválido: ${field}.`);
  let t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (trim) t = t.trim();
  if (required && !t.trim()) throw new ValidationError(`Preencha ${field}.`);
  if (t.length > max) throw new ValidationError(`${field} passa do limite de ${max} caracteres.`);
  return t;
}

export const MODEL_PREF_RE = /^(auto|[a-z]{3,20}\|[A-Za-z0-9._:\/\-]{1,100})$/;

export function cleanModelPref(v: unknown): string {
  const pm = v === undefined || v === null || v === "" ? "auto" : v;
  if (typeof pm !== "string" || !MODEL_PREF_RE.test(pm)) throw new ValidationError("Modelo preferido inválido.");
  return pm;
}
