// Senha única do app (texto livre, sensível a maiúsculas/minúsculas). Módulo puro (WebCrypto), testável com vitest.
// A senha NUNCA é guardada: só "pbkdf2$<iterações>$<sal>$<hash>", onde a entrada do PBKDF2 é HMAC-SHA256(pepper do servidor, senha).
// O pepper fica na tabela privada am_server_secrets; sal é aleatório por senha.

export const PBKDF2_ITERATIONS = 600_000;
export const PASSWORD_MAX = 200;
export const PASSWORD_MIN_SET = 4; // só vale ao DEFINIR a senha (script do administrador); o login aceita qualquer texto não vazio

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Apenas remove espaços/quebras de linha das PONTAS. Maiúsculas/minúsculas e o meio da senha são preservados. */
export function normalizePassword(raw: unknown): { ok: true; value: string } | { ok: false; reason: "type" | "empty" | "too_long" } {
  if (typeof raw !== "string") return { ok: false, reason: "type" };
  const v = raw.trim();
  if (!v) return { ok: false, reason: "empty" };
  if (v.length > PASSWORD_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, value: v };
}

async function hmac(key: string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

async function derive(password: string, pepper: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey("raw", await hmac(pepper, "pw:" + password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations }, material, 256);
  return hex(bits);
}

export async function hashPassword(password: string, pepper: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${hex(salt)}$${await derive(password, pepper, salt, iterations)}`;
}

function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a), eb = enc.encode(b);
  let d = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return d === 0;
}

// Hash "falso" para gastar o mesmo tempo quando ainda não existe senha definida (evita diferença de tempo).
const DUMMY = `pbkdf2$${PBKDF2_ITERATIONS}$00000000000000000000000000000000$${"0".repeat(64)}`;

export async function verifyPassword(password: string, stored: string | null | undefined, pepper: string): Promise<boolean> {
  const parts = (stored || DUMMY).split("$");
  const real = !!stored && parts.length === 4 && parts[0] === "pbkdf2";
  const [, itStr, saltHex, want] = real ? parts : DUMMY.split("$");
  const iterations = Math.min(Math.max(Number(itStr) || PBKDF2_ITERATIONS, 1000), 2_000_000);
  const got = await derive(password, pepper, unhex(saltHex), iterations);
  return safeEqual(got, want) && real;
}
