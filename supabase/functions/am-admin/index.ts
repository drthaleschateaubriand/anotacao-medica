// Edge Function `am-admin`: o ADMINISTRADOR define a senha do app e cadastra/remove chaves de provedores (nada disso passa pelo chat).
// Autenticação: cabeçalho `x-admin-token` comparado (hash SHA-256, tempo constante) com ADMIN_TOKEN_HASH em server_secrets.
// Corpo: { action: "set-password"|"owner-status"|"clear-login-blocks"|"set"|"delete"|"status"|"clear-cooldown"|"pause", provider: "groq"|"gemini"|"openrouter", key?, password? }
import { db, invalidateSecret, requireSecret } from "../_shared/db.ts";
import { sha256Hex, timingSafeEqual } from "../_shared/crypto.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { ipHash, rateHit, ratePeek, tooMany } from "../_shared/session.ts";
import { KEY_SECRET, PROVIDER_IDS } from "../_shared/providers/registry.ts";
import { PASSWORD_MIN_SET, hashPassword, normalizePassword } from "../_shared/password.ts";

const CHECKS: Record<string, (key: string) => Promise<boolean>> = {
  groq: async (k) => (await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  gemini: async (k) => (await fetch("https://generativelanguage.googleapis.com/v1beta/openai/models", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
  openrouter: async (k) => (await fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10000) })).ok,
};

serve(async (req) => {
  const ip = await ipHash(req);
  const rl = await rateHit("admin_ip", ip, 60, 600, 120);
  if (!rl.allowed) throw tooMany(rl.retryAfter);
  const blocked = await ratePeek("admin_fail_ip", ip);
  if (blocked > 0) throw tooMany(blocked);
  const token = req.headers.get("x-admin-token") ?? "";
  const expected = await requireSecret("ADMIN_TOKEN_HASH");
  const okAuth = token.length > 0 && token.length < 200 && timingSafeEqual(await sha256Hex(token), expected);
  if (!okAuth) {
    await rateHit("admin_fail_ip", ip, 5, 900, 600, 86400);
    throw new HttpError(401, "unauthorized", "Não autorizado.");
  }
  const body = await readJson(req, 20_000);
  const action = String(body.action ?? "");
  const provider = String(body.provider ?? "");

  // ---- Conta única do dono (app privado) ----
  if (action === "owner-status") {
    const { data } = await db().from("am_users").select("id,pw_hash,pw_changed_at,last_login_at").eq("is_owner", true).maybeSingle();
    return json(req, { owner_exists: !!data, password_set: !!data?.pw_hash, pw_changed_at: data?.pw_changed_at ?? null, last_login_at: data?.last_login_at ?? null });
  }
  if (action === "set-password") {
    // Define (ou troca) a senha do dono. Cria o dono se ainda não existir. A senha nunca é registrada nem devolvida.
    const pw = normalizePassword(body.password);
    if (!pw.ok) throw new HttpError(400, "bad_request", "Senha inválida (vazia, longa demais ou não é texto).");
    if (pw.value.length < PASSWORD_MIN_SET) throw new HttpError(400, "bad_request", `Senha curta demais (mínimo ${PASSWORD_MIN_SET} caracteres).`);
    const hash = await hashPassword(pw.value, await requireSecret("PEPPER"));
    const { data: ex } = await db().from("am_users").select("id").eq("is_owner", true).maybeSingle();
    let created = false;
    let uid = ex?.id as string | undefined;
    if (!uid) {
      const { data, error } = await db().from("am_users").insert({ is_owner: true, pw_hash: hash, pw_changed_at: new Date().toISOString() }).select("id").single();
      if (error) throw new Error("owner_create_failed");
      uid = data.id as string;
      const { error: e2 } = await db().from("am_preferences").insert({ user_id: uid });
      if (e2) { await db().from("am_users").delete().eq("id", uid); throw new Error("prefs_create_failed"); }
      created = true;
    } else {
      const { error } = await db().from("am_users").update({ pw_hash: hash, pw_changed_at: new Date().toISOString() }).eq("id", uid);
      if (error) throw new Error("password_update_failed");
      await db().from("am_sessions").update({ revoked_at: new Date().toISOString() }).eq("user_id", uid).is("revoked_at", null); // sessões antigas caem
    }
    await db().from("am_auth_attempts").insert({ kind: "set_password", ok: true, ip_hash: ip, reason: created ? "created" : "changed" });
    return json(req, { ok: true, created, sessions_revoked: !created, data_preserved: true });
  }
  if (action === "clear-login-blocks") {
    // remove bloqueios de login (ex.: depois de testes de força bruta ou se o próprio dono se bloqueou)
    const { data } = await db().from("am_rate_limits").delete().in("scope", ["login_ip", "login_fail_ip", "login_fail_global", "login_global"]).select("scope");
    return json(req, { ok: true, cleared: data?.length ?? 0 });
  }

  if (action === "status") {
    const out: Record<string, boolean> = {};
    for (const [p, secret] of Object.entries(KEY_SECRET)) {
      const { data } = await db().from("am_server_secrets").select("name").eq("name", secret).maybeSingle();
      out[p] = !!data;
    }
    return json(req, { configured: out, pollinations: "anônimo (sem chave)" });
  }

  if (action === "pause" || action === "clear-cooldown") {
    if (!(PROVIDER_IDS as readonly string[]).includes(provider)) throw new HttpError(400, "bad_request", "Provedor inválido.");
    if (action === "clear-cooldown") {
      await db().from("am_provider_state").delete().eq("provider", provider);
      return json(req, { ok: true });
    }
    const secs = Math.min(Math.max(Number(body.seconds) || 60, 1), 86400);
    await db().from("am_provider_state").upsert({
      provider, model: "*", cooldown_until: new Date(Date.now() + secs * 1000).toISOString(), last_error: "pausado manualmente (admin)",
      consecutive_failures: 0, updated_at: new Date().toISOString(),
    });
    return json(req, { ok: true, paused_seconds: secs });
  }

  if (!KEY_SECRET[provider]) throw new HttpError(400, "bad_request", "Provedor inválido. Use groq, gemini ou openrouter.");
  const secret = KEY_SECRET[provider];

  if (action === "set") {
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, "bad_request", "Chave inválida.");
    if (body.validate !== false) {
      let valid = false;
      try { valid = await CHECKS[provider](key); } catch { valid = false; }
      if (!valid) throw new HttpError(422, "key_rejected", "O provedor recusou esta chave (ou não respondeu). Nada foi gravado. Use validate:false para gravar mesmo assim.");
    }
    const { error } = await db().from("am_server_secrets").upsert({ name: secret, value: key, updated_at: new Date().toISOString() });
    if (error) throw new Error("secret_write_failed");
    invalidateSecret(secret);
    // limpa cooldowns antigos (ex.: 401 de uma chave anterior)
    await db().from("am_provider_state").delete().eq("provider", provider);
    return json(req, { ok: true, provider, validated: body.validate !== false });
  }
  if (action === "delete") {
    await db().from("am_server_secrets").delete().eq("name", secret);
    invalidateSecret(secret);
    return json(req, { ok: true, provider, removed: true });
  }
  throw new HttpError(400, "bad_request", "Ação inválida.");
});
