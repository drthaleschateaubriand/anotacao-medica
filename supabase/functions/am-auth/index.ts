// Edge Function `am-auth`: login por SENHA única (cadastro público FECHADO: app privado), sessões, refresh com rotação, revogação.
import { db, requireSecret } from "../_shared/db.ts";
import { normalizePassword, verifyPassword } from "../_shared/password.ts";
import { randomToken, sha256Hex } from "../_shared/crypto.ts";
import { HttpError, clientIp, json, readJson, serve, str, uuid } from "../_shared/http.ts";
import { ipHash, rateHit, ratePeek, requireSession, tooMany } from "../_shared/session.ts";

const ACCESS_TTL_S = 15 * 60; // acesso curto
const REFRESH_PERSISTENT_S = 30 * 24 * 3600; // "manter conectado": 30 dias
const REFRESH_SHORT_S = 12 * 3600; // sessão curta: 12 horas
const GENERIC_LOGIN_ERROR = "Senha incorreta.";

const iso = (ms: number) => new Date(ms).toISOString();

function deviceNameFrom(ua: string, custom?: unknown): string {
  if (typeof custom === "string" && custom.trim()) return custom.trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 60);
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux|X11/.test(ua) ? "Linux" : "Dispositivo";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

async function logAttempt(kind: string, ok: boolean, ip: string, reason?: string) {
  await db().from("am_auth_attempts").insert({ kind, ok, ip_hash: ip, reason: reason ?? null });
}

async function createSession(userId: string, persistent: boolean, req: Request, ip: string, custom?: unknown) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  const { data, error } = await db().from("am_sessions").insert({
    user_id: userId,
    access_hash: await sha256Hex(access),
    access_expires_at: iso(now + ACCESS_TTL_S * 1000),
    refresh_hash: await sha256Hex(refresh),
    refresh_expires_at: iso(now + (persistent ? REFRESH_PERSISTENT_S : REFRESH_SHORT_S) * 1000),
    persistent,
    device_name: deviceNameFrom(ua, custom),
    user_agent: ua,
    ip_hash: ip,
  }).select("id").single();
  if (error) throw new Error("session_create_failed");
  return {
    session_id: data.id as string,
    access_token: access,
    access_expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    refresh_expires_in: persistent ? REFRESH_PERSISTENT_S : REFRESH_SHORT_S,
    persistent,
  };
}

serve(async (req, action) => {
  const body = await readJson(req);
  const ip = await ipHash(req);

  switch (action) {
    // APP PRIVADO: não há cadastro público nem recuperação pública. A senha só é definida pelo administrador (am-admin + ADMIN_TOKEN).
    case "challenge":
    case "pow-challenge":
    case "register":
    case "signup":
    case "recover":
    case "reset":
    case "generate-code":
      throw new HttpError(403, "registration_closed", "Este app é privado: não há criação de contas.");

    case "login": {
      const g = await rateHit("login_global", "all", 600, 600, 30, 600);
      if (!g.allowed) throw tooMany(g.retryAfter);
      const a = await rateHit("login_ip", ip, 30, 600, 60);
      if (!a.allowed) throw tooMany(a.retryAfter);
      // bloqueio progressivo por IP (5 falhas/15 min => 5 min, depois 10, 20… até 24 h) e teto global de falhas contra ataque distribuído
      const blocked = await ratePeek("login_fail_ip", ip);
      if (blocked > 0) throw tooMany(blocked);
      const gblocked = await ratePeek("login_fail_global", "all");
      if (gblocked > 0) throw tooMany(gblocked);

      const fail = async (reason: string) => {
        await logAttempt("login", false, ip, reason);
        const gf = await rateHit("login_fail_global", "all", 100, 3600, 900, 7200);
        const f = await rateHit("login_fail_ip", ip, 5, 900, 300);
        if (!f.allowed) throw tooMany(f.retryAfter);
        if (!gf.allowed) throw tooMany(gf.retryAfter);
        throw new HttpError(401, "invalid_credentials", GENERIC_LOGIN_ERROR);
      };
      const pw = normalizePassword(body.password);
      if (!pw.ok) return await fail("format_" + pw.reason);

      const pepper = await requireSecret("PEPPER");
      const { data: user, error } = await db().from("am_users").select("id,pw_hash").eq("is_owner", true).maybeSingle();
      if (error) throw new Error("user_lookup_failed");
      const okPw = await verifyPassword(pw.value, user?.pw_hash, pepper); // gasta o mesmo tempo mesmo sem senha definida
      if (!user || !okPw) return await fail("bad_password");

      const persistent = body.persistent !== false;
      const session = await createSession(user.id, persistent, req, ip, body.device_name);
      await db().from("am_users").update({ last_login_at: iso(Date.now()) }).eq("id", user.id);
      await logAttempt("login", true, ip);
      if (Math.random() < 0.02) await db().rpc("am_housekeeping");
      return json(req, { ...session });
    }

    case "refresh": {
      const r = await rateHit("refresh_ip", ip, 120, 600, 60);
      if (!r.allowed) throw tooMany(r.retryAfter);
      const token = str(body.refresh_token, 100);
      const hash = await sha256Hex(token);
      const { data: s, error } = await db().from("am_sessions")
        .select("id,user_id,persistent,created_at,refresh_expires_at,revoked_at,rotated_at").eq("refresh_hash", hash).maybeSingle();
      if (error) throw new Error("refresh_lookup_failed");
      if (!s) {
        // reuso de um refresh antigo após rotação => possível roubo: revoga a sessão (exceto corrida legítima de abas)
        const { data: old } = await db().from("am_sessions").select("id,rotated_at,revoked_at").eq("prev_refresh_hash", hash).maybeSingle();
        if (old && !old.revoked_at) {
          if (old.rotated_at && Date.now() - new Date(old.rotated_at).getTime() < 20_000) {
            throw new HttpError(409, "refresh_race", "Sessão já renovada por outra aba. Tente de novo.");
          }
          await db().from("am_sessions").update({ revoked_at: iso(Date.now()) }).eq("id", old.id);
        }
        throw new HttpError(401, "unauthorized", "Sessão inválida.");
      }
      if (s.revoked_at || new Date(s.refresh_expires_at).getTime() <= Date.now()) throw new HttpError(401, "unauthorized", "Sessão encerrada ou expirada.");
      const access = randomToken(32);
      const refresh = randomToken(32);
      const now = Date.now();
      const refreshExp = s.persistent ? now + REFRESH_PERSISTENT_S * 1000 : Math.min(new Date(s.refresh_expires_at).getTime(), new Date(s.created_at).getTime() + REFRESH_SHORT_S * 1000);
      // update condicional: só rotaciona se o refresh ainda for o mesmo (evita duas rotações concorrentes)
      const { data: upd, error: ue } = await db().from("am_sessions").update({
        access_hash: await sha256Hex(access), access_expires_at: iso(now + ACCESS_TTL_S * 1000),
        refresh_hash: await sha256Hex(refresh), prev_refresh_hash: hash, refresh_expires_at: iso(refreshExp),
        rotated_at: iso(now), last_seen_at: iso(now),
      }).eq("id", s.id).eq("refresh_hash", hash).select("id");
      if (ue) throw new Error("refresh_failed");
      if (!upd || upd.length === 0) throw new HttpError(409, "refresh_race", "Sessão já renovada por outra aba. Tente de novo.");
      return json(req, {
        session_id: s.id, access_token: access, access_expires_in: ACCESS_TTL_S, refresh_token: refresh,
        refresh_expires_in: Math.floor((refreshExp - now) / 1000), persistent: s.persistent,
      });
    }

    case "me": {
      const a = await requireSession(req);
      const { data } = await db().from("am_users").select("id,created_at").eq("id", a.userId).single();
      return json(req, { user: { id: data?.id, created_at: data?.created_at }, session_id: a.sessionId });
    }

    case "logout": {
      const a = await requireSession(req);
      await db().from("am_sessions").update({ revoked_at: iso(Date.now()) }).eq("id", a.sessionId).eq("user_id", a.userId);
      return json(req, { ok: true });
    }

    case "logout-all": {
      const a = await requireSession(req);
      await db().from("am_sessions").update({ revoked_at: iso(Date.now()) }).eq("user_id", a.userId).is("revoked_at", null);
      return json(req, { ok: true });
    }

    case "sessions": {
      const a = await requireSession(req);
      const { data, error } = await db().from("am_sessions")
        .select("id,device_name,created_at,last_seen_at,persistent,refresh_expires_at")
        .eq("user_id", a.userId).is("revoked_at", null).gt("refresh_expires_at", iso(Date.now()))
        .order("last_seen_at", { ascending: false });
      if (error) throw new Error("sessions_failed");
      return json(req, { sessions: (data ?? []).map((s) => ({ ...s, current: s.id === a.sessionId })) });
    }

    case "revoke-session": {
      const a = await requireSession(req);
      const id = uuid(body.id);
      // a propriedade é verificada pelo filtro user_id da SESSÃO autenticada
      const { data } = await db().from("am_sessions").update({ revoked_at: iso(Date.now()) }).eq("id", id).eq("user_id", a.userId).is("revoked_at", null).select("id");
      if (!data || data.length === 0) throw new HttpError(404, "not_found", "Dispositivo não encontrado.");
      return json(req, { ok: true, was_current: id === a.sessionId });
    }

    default:
      throw new HttpError(404, "not_found", "Rota inexistente.");
  }
});

// evita aviso de import não usado em algumas versões do Deno
void clientIp;
