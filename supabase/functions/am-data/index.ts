// Edge Function `am-data`: notas, conversas, mensagens, memórias, agentes, skills, preferências, modelos e exportação.
// Toda consulta filtra por user_id vindo da SESSÃO (nunca do corpo).
import { db } from "../_shared/db.ts";
import { HttpError, json, readJson, serve, str, uuid } from "../_shared/http.ts";
import { rateHit, requireSession, tooMany } from "../_shared/session.ts";
import { manager } from "../_shared/providers/index.ts";
import { AGENT_LIMITS, NOTE_LIMITS, SKILL_LIMITS, ValidationError, validateAgentInput, validateNoteInput, validateSkillInput } from "../_shared/agents.ts";

const THEMES = ["system", "light", "dark"];
const FONTS = ["sm", "md", "lg"];
const LANGS = ["pt-BR", "en-US", "es-ES"];
const MODEL_RE = /^(auto|[a-z]{3,20}\|[A-Za-z0-9._:\/\-]{1,100})$/;
const CONV_FIELDS = "id,title,pinned,agent_id,created_at,updated_at";
const AGENT_FIELDS = "id,name,description,instructions,emoji,preferred_model,created_at,updated_at";
const SKILL_FIELDS = "id,name,description,instructions,preferred_model,is_global,created_at,updated_at";
const NOTE_FIELDS = "id,title,content,pinned,created_at,updated_at";
const PREF_FIELDS = "theme,font_size,language,memory_enabled,default_model,auto_speak";

/** Agentes do usuário com a lista de skills (skill_ids) de cada um. */
async function agentsWithSkills(uid: string) {
  const [ag, links] = await Promise.all([
    db().from("am_agents").select(AGENT_FIELDS).eq("user_id", uid).order("created_at").limit(AGENT_LIMITS.perUser),
    db().from("am_agent_skills").select("agent_id,skill_id,position").eq("user_id", uid).order("position"),
  ]);
  const by = new Map<string, string[]>();
  for (const l of links.data ?? []) by.set(l.agent_id, [...(by.get(l.agent_id) ?? []), l.skill_id]);
  return (ag.data ?? []).map((a) => ({ ...a, skill_ids: by.get(a.id) ?? [] }));
}
async function skillList(uid: string) {
  const { data } = await db().from("am_skills").select(SKILL_FIELDS).eq("user_id", uid).order("created_at").limit(SKILL_LIMITS.perUser);
  return data ?? [];
}
async function ownSkill(userId: string, id: unknown) {
  const { data } = await db().from("am_skills").select(SKILL_FIELDS).eq("id", uuid(id)).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Skill não encontrada.");
  return data;
}
async function ownNote(userId: string, id: unknown) {
  const { data } = await db().from("am_notes").select(NOTE_FIELDS).eq("id", uuid(id)).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Nota não encontrada.");
  return data;
}
async function notesMeta(uid: string, q: string) {
  const { data, error } = await db().rpc("am_notes_list", { p_user: uid, p_q: q });
  if (error) throw new Error("notes_list_failed");
  return data ?? [];
}
async function assertGlobalLimit(uid: string, exceptId?: string) {
  let qy = db().from("am_skills").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("is_global", true);
  if (exceptId) qy = qy.neq("id", exceptId);
  const { count } = await qy;
  if ((count ?? 0) >= SKILL_LIMITS.globalMax) throw new HttpError(400, "limit", `No máximo ${SKILL_LIMITS.globalMax} skills globais ao mesmo tempo.`);
}
const MSG_FIELDS = "id,seq,conversation_id,role,content,provider,model,fallback_used,created_at";

async function ownConv(userId: string, id: unknown) {
  const cid = uuid(id);
  const { data } = await db().from("am_conversations").select(CONV_FIELDS).eq("id", cid).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Conversa não encontrada.");
  return data;
}

async function ownAgent(userId: string, id: unknown) {
  const { data } = await db().from("am_agents").select(AGENT_FIELDS).eq("id", uuid(id)).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "Agente não encontrado.");
  return data;
}
function agentInput(body: Record<string, unknown>) {
  try { return validateAgentInput(body); } catch (e) {
    if (e instanceof ValidationError) throw new HttpError(400, "bad_request", e.message);
    throw e;
  }
}

function escLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => "\\" + c);
}

serve(async (req) => {
  const a = await requireSession(req);
  const uid = a.userId;
  const body = await readJson(req);
  const action = String(body.action ?? "");
  const rl = await rateHit("data_user_min", uid, 240, 60, 20, 300);
  if (!rl.allowed) throw tooMany(rl.retryAfter);

  switch (action) {
    case "bootstrap": {
      const [p, c, ag, sk, notes] = await Promise.all([
        db().from("am_preferences").select(PREF_FIELDS).eq("user_id", uid).maybeSingle(),
        db().from("am_conversations").select(CONV_FIELDS).eq("user_id", uid).order("updated_at", { ascending: false }).limit(500),
        agentsWithSkills(uid),
        skillList(uid),
        notesMeta(uid, ""),
      ]);
      return json(req, { preferences: p.data, conversations: c.data ?? [], agents: ag, skills: sk, notes });
    }

    // ---------------- NOTAS (bloco de notas) ----------------
    case "note.list": {
      const q = typeof body.q === "string" ? body.q.trim().slice(0, 100) : "";
      return json(req, { notes: await notesMeta(uid, q) });
    }
    case "note.get": return json(req, { note: await ownNote(uid, body.id) });
    case "note.create": {
      const { count } = await db().from("am_notes").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= NOTE_LIMITS.perUser) throw new HttpError(400, "limit", `Limite de ${NOTE_LIMITS.perUser} notas atingido.`);
      let input;
      try { input = validateNoteInput(body); } catch (e) { if (e instanceof ValidationError) throw new HttpError(400, "bad_request", e.message); throw e; }
      const { data, error } = await db().from("am_notes").insert({ user_id: uid, title: input.title ?? "", content: input.content ?? "", pinned: input.pinned ?? false }).select(NOTE_FIELDS).single();
      if (error) throw new Error("note_create_failed");
      return json(req, { note: data }, 201);
    }
    case "note.update": {
      const cur = await ownNote(uid, body.id);
      // controle de edição simultânea (outro dispositivo): se a nota mudou desde a versão que o app tinha, não sobrescreve
      if (typeof body.base_updated_at === "string" && body.force !== true && new Date(body.base_updated_at).getTime() !== new Date(cur.updated_at).getTime()) {
        throw new HttpError(409, "conflict", "Esta nota foi alterada em outro dispositivo.", { note: cur });
      }
      let input;
      try { input = validateNoteInput(body); } catch (e) { if (e instanceof ValidationError) throw new HttpError(400, "bad_request", e.message); throw e; }
      const { data, error } = await db().from("am_notes").update({ ...input, updated_at: new Date().toISOString() }).eq("id", cur.id).eq("user_id", uid).select(NOTE_FIELDS).single();
      if (error) throw new Error("note_update_failed");
      return json(req, { note: data });
    }
    case "note.delete": {
      await ownNote(uid, body.id);
      await db().from("am_notes").delete().eq("id", uuid(body.id)).eq("user_id", uid);
      return json(req, { ok: true });
    }

    // ---------------- SKILLS ----------------
    case "skill.list": return json(req, { skills: await skillList(uid) });
    case "skill.create":
    case "skill.duplicate": {
      const { count } = await db().from("am_skills").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= SKILL_LIMITS.perUser) throw new HttpError(400, "limit", `Limite de ${SKILL_LIMITS.perUser} skills atingido.`);
      let input;
      if (action === "skill.duplicate") {
        const src = await ownSkill(uid, body.id);
        input = { name: `${src.name} (cópia)`.slice(0, SKILL_LIMITS.name), description: src.description, instructions: src.instructions, preferred_model: src.preferred_model, is_global: false };
      } else {
        try { input = validateSkillInput(body); } catch (e) { if (e instanceof ValidationError) throw new HttpError(400, "bad_request", e.message); throw e; }
      }
      if (input.is_global) await assertGlobalLimit(uid);
      const { data, error } = await db().from("am_skills").insert({ user_id: uid, ...input }).select(SKILL_FIELDS).single();
      if (error) throw new Error("skill_create_failed");
      return json(req, { skill: data }, 201);
    }
    case "skill.update": {
      await ownSkill(uid, body.id);
      let input;
      try { input = validateSkillInput(body); } catch (e) { if (e instanceof ValidationError) throw new HttpError(400, "bad_request", e.message); throw e; }
      if (input.is_global) await assertGlobalLimit(uid, uuid(body.id));
      const { data, error } = await db().from("am_skills").update({ ...input, updated_at: new Date().toISOString() }).eq("id", uuid(body.id)).eq("user_id", uid).select(SKILL_FIELDS).single();
      if (error) throw new Error("skill_update_failed");
      return json(req, { skill: data });
    }
    case "skill.delete": {
      await ownSkill(uid, body.id);
      await db().from("am_skills").delete().eq("id", uuid(body.id)).eq("user_id", uid); // vínculos com agentes caem em cascata
      return json(req, { ok: true });
    }
    case "agent.set_skills": {
      await ownAgent(uid, body.id);
      const ids = Array.isArray(body.skill_ids) ? [...new Set(body.skill_ids.map((x) => uuid(x)))] : [];
      if (ids.length > AGENT_LIMITS.skillsPerAgent) throw new HttpError(400, "limit", `No máximo ${AGENT_LIMITS.skillsPerAgent} skills por agente.`);
      if (ids.length) {
        const { data } = await db().from("am_skills").select("id").eq("user_id", uid).in("id", ids);
        if ((data?.length ?? 0) !== ids.length) throw new HttpError(404, "not_found", "Skill não encontrada.");
      }
      await db().from("am_agent_skills").delete().eq("agent_id", uuid(body.id)).eq("user_id", uid);
      if (ids.length) {
        const { error } = await db().from("am_agent_skills").insert(ids.map((skill_id, position) => ({ agent_id: uuid(body.id), skill_id, user_id: uid, position })));
        if (error) throw new Error("agent_skills_failed");
      }
      return json(req, { agents: await agentsWithSkills(uid) });
    }

    case "conv.list": {
      const { data } = await db().from("am_conversations").select(CONV_FIELDS).eq("user_id", uid).order("updated_at", { ascending: false }).limit(500);
      return json(req, { conversations: data ?? [] });
    }

    case "conv.create": {
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Nova conversa";
      let agent_id: string | null = null;
      if (body.agent_id !== undefined && body.agent_id !== null) agent_id = (await ownAgent(uid, body.agent_id)).id;
      const { data, error } = await db().from("am_conversations").insert({ user_id: uid, title, agent_id }).select(CONV_FIELDS).single();
      if (error) throw new Error("conv_create_failed");
      return json(req, { conversation: data }, 201);
    }

    case "conv.set_agent": {
      // troca ou remove (agent_id: null) o agente de uma conversa; ambos precisam ser do usuário da sessão
      await ownConv(uid, body.id);
      const agent_id = body.agent_id === null || body.agent_id === undefined ? null : (await ownAgent(uid, body.agent_id)).id;
      const { data } = await db().from("am_conversations").update({ agent_id }).eq("id", uuid(body.id)).eq("user_id", uid).select(CONV_FIELDS).single();
      return json(req, { conversation: data });
    }

    case "agent.list": {
      return json(req, { agents: await agentsWithSkills(uid) });
    }
    case "agent.create":
    case "agent.duplicate": {
      const { count } = await db().from("am_agents").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= AGENT_LIMITS.perUser) throw new HttpError(400, "limit", `Limite de ${AGENT_LIMITS.perUser} agentes atingido.`);
      let input;
      if (action === "agent.duplicate") {
        const src = await ownAgent(uid, body.id);
        const name = `${src.name} (cópia)`.slice(0, AGENT_LIMITS.name);
        input = { name, description: src.description, instructions: src.instructions, emoji: src.emoji, preferred_model: src.preferred_model };
      } else input = agentInput(body);
      const { data, error } = await db().from("am_agents").insert({ user_id: uid, ...input }).select(AGENT_FIELDS).single();
      if (error) throw new Error("agent_create_failed");
      return json(req, { agent: { ...data, skill_ids: [] } }, 201);
    }
    case "agent.update": {
      await ownAgent(uid, body.id);
      const input = agentInput(body);
      const { data, error } = await db().from("am_agents").update({ ...input, updated_at: new Date().toISOString() }).eq("id", uuid(body.id)).eq("user_id", uid).select(AGENT_FIELDS).single();
      if (error) throw new Error("agent_update_failed");
      return json(req, { agent: { ...data, skill_ids: (await agentsWithSkills(uid)).find((x) => x.id === data.id)?.skill_ids ?? [] } });
    }
    case "agent.delete": {
      await ownAgent(uid, body.id);
      await db().from("am_agents").delete().eq("id", uuid(body.id)).eq("user_id", uid); // conversas ficam (agent_id vira null)
      return json(req, { ok: true });
    }

    case "conv.rename": {
      await ownConv(uid, body.id);
      const title = str(body.title, 200).trim().slice(0, 120);
      if (!title) throw new HttpError(400, "bad_request", "Título vazio.");
      const { data } = await db().from("am_conversations").update({ title }).eq("id", uuid(body.id)).eq("user_id", uid).select(CONV_FIELDS).single();
      return json(req, { conversation: data });
    }

    case "conv.pin": {
      await ownConv(uid, body.id);
      const { data } = await db().from("am_conversations").update({ pinned: body.pinned === true }).eq("id", uuid(body.id)).eq("user_id", uid).select(CONV_FIELDS).single();
      return json(req, { conversation: data });
    }

    case "conv.delete": {
      await ownConv(uid, body.id);
      await db().from("am_conversations").delete().eq("id", uuid(body.id)).eq("user_id", uid);
      return json(req, { ok: true });
    }

    case "conv.messages": {
      const conv = await ownConv(uid, body.id);
      const { data } = await db().from("am_messages").select(MSG_FIELDS).eq("conversation_id", conv.id).eq("user_id", uid).order("seq").limit(2000);
      return json(req, { conversation: conv, messages: data ?? [] });
    }

    case "conv.search": {
      const q = str(body.q, 100).trim();
      if (q.length < 2) return json(req, { results: [] });
      const like = `%${escLike(q)}%`;
      const [t, m] = await Promise.all([
        db().from("am_conversations").select(CONV_FIELDS).eq("user_id", uid).ilike("title", like).limit(30),
        db().from("am_messages").select("conversation_id,content,created_at").eq("user_id", uid).ilike("content", like).order("created_at", { ascending: false }).limit(60),
      ]);
      const ids = new Set<string>();
      const results: { conversation_id: string; title: string; snippet: string; updated_at: string; pinned: boolean }[] = [];
      for (const c of t.data ?? []) { ids.add(c.id); results.push({ conversation_id: c.id, title: c.title, snippet: "", updated_at: c.updated_at, pinned: c.pinned }); }
      const need = [...new Set((m.data ?? []).map((x) => x.conversation_id))].filter((i) => !ids.has(i));
      const convs = need.length ? (await db().from("am_conversations").select(CONV_FIELDS).eq("user_id", uid).in("id", need)).data ?? [] : [];
      const byId = new Map(convs.map((c) => [c.id, c]));
      for (const msg of m.data ?? []) {
        const c = byId.get(msg.conversation_id);
        if (!c || ids.has(c.id)) continue;
        ids.add(c.id);
        const i = msg.content.toLowerCase().indexOf(q.toLowerCase());
        const snippet = msg.content.slice(Math.max(0, i - 40), i + q.length + 80).replace(/\s+/g, " ");
        results.push({ conversation_id: c.id, title: c.title, snippet, updated_at: c.updated_at, pinned: c.pinned });
      }
      return json(req, { results });
    }

    case "mem.list": {
      const { data } = await db().from("am_memories").select("id,content,created_at,updated_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(200);
      return json(req, { memories: data ?? [] });
    }
    case "mem.create": {
      const content = str(body.content, 1000).trim().slice(0, 500);
      if (!content) throw new HttpError(400, "bad_request", "Memória vazia.");
      const { count } = await db().from("am_memories").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= 100) throw new HttpError(400, "limit", "Limite de 100 memórias atingido.");
      const { data, error } = await db().from("am_memories").insert({ user_id: uid, content }).select("id,content,created_at,updated_at").single();
      if (error) throw new Error("mem_create_failed");
      return json(req, { memory: data }, 201);
    }
    case "mem.update": {
      const content = str(body.content, 1000).trim().slice(0, 500);
      if (!content) throw new HttpError(400, "bad_request", "Memória vazia.");
      const { data } = await db().from("am_memories").update({ content, updated_at: new Date().toISOString() }).eq("id", uuid(body.id)).eq("user_id", uid).select("id,content,created_at,updated_at");
      if (!data || !data.length) throw new HttpError(404, "not_found", "Memória não encontrada.");
      return json(req, { memory: data[0] });
    }
    case "mem.delete": {
      const { data } = await db().from("am_memories").delete().eq("id", uuid(body.id)).eq("user_id", uid).select("id");
      if (!data || !data.length) throw new HttpError(404, "not_found", "Memória não encontrada.");
      return json(req, { ok: true });
    }

    case "prefs.get": {
      const { data } = await db().from("am_preferences").select("theme,font_size,language,memory_enabled,default_model,auto_speak").eq("user_id", uid).maybeSingle();
      return json(req, { preferences: data });
    }
    case "prefs.update": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.theme !== undefined) { if (!THEMES.includes(String(body.theme))) throw new HttpError(400, "bad_request", "Tema inválido."); patch.theme = body.theme; }
      if (body.font_size !== undefined) { if (!FONTS.includes(String(body.font_size))) throw new HttpError(400, "bad_request", "Tamanho inválido."); patch.font_size = body.font_size; }
      if (body.language !== undefined) { if (!LANGS.includes(String(body.language))) throw new HttpError(400, "bad_request", "Idioma inválido."); patch.language = body.language; }
      if (body.memory_enabled !== undefined) patch.memory_enabled = body.memory_enabled === true;
      if (body.auto_speak !== undefined) patch.auto_speak = body.auto_speak === true;
      if (body.default_model !== undefined) { if (!MODEL_RE.test(String(body.default_model))) throw new HttpError(400, "bad_request", "Modelo inválido."); patch.default_model = body.default_model; }
      const { data } = await db().from("am_preferences").update(patch).eq("user_id", uid).select("theme,font_size,language,memory_enabled,default_model,auto_speak").single();
      return json(req, { preferences: data });
    }

    case "models.list": {
      const catalog = await manager().catalog();
      const today = new Date().toISOString().slice(0, 10);
      const { data: usage } = await db().from("am_provider_usage").select("provider,model,requests,tokens_in,tokens_out,errors,rate_limited,limit_info").eq("day", today);
      return json(req, { catalog, usage: usage ?? [], day: today });
    }

    case "export.all": {
      const [p, c, m, mem, s2, ag, sk, notes] = await Promise.all([
        db().from("am_preferences").select(PREF_FIELDS).eq("user_id", uid).maybeSingle(),
        db().from("am_conversations").select("id,title,pinned,agent_id,summary,created_at,updated_at").eq("user_id", uid).order("created_at"),
        db().from("am_messages").select("id,conversation_id,role,content,provider,model,fallback_used,tokens_in,tokens_out,created_at").eq("user_id", uid).order("seq"),
        db().from("am_memories").select("id,content,created_at,updated_at").eq("user_id", uid).order("created_at"),
        db().from("am_sessions").select("id,device_name,created_at,last_seen_at,persistent,revoked_at").eq("user_id", uid),
        agentsWithSkills(uid),
        skillList(uid),
        db().from("am_notes").select(NOTE_FIELDS).eq("user_id", uid).order("created_at"),
      ]);
      return json(req, { exported_at: new Date().toISOString(), app: "Anotação Médica", preferences: p.data, notes: notes.data ?? [], conversations: c.data ?? [], messages: m.data ?? [], memories: mem.data ?? [], agents: ag, skills: sk, devices: s2.data ?? [] });
    }

    default:
      throw new HttpError(404, "not_found", "Ação inexistente.");
  }
});
