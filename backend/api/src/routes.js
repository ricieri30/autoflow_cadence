import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cronParser from "cron-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

import { auth } from "./auth.js";
import { render } from "./template.js";
import { User, Contact, Template, Recurring, ScheduledMessage, AutoReply,
         OnboardingConfig, PipelineConfig, PipelineContact, Audit } from "./models.js";
import { makeQueue, upsertRecurringScheduler, removeRecurringScheduler } from "./scheduler.js";

const router = express.Router();
// wrap: captura erros de handlers async e os repassa ao error handler central,
// evitando que uma excecao (ex.: CastError) derrube o processo inteiro.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const queue = makeQueue();

// ══════════════════════════════════════════════════════════════════
// HELPERS COMPARTILHADOS — usados por /auto-reply/test e /internal/message
// Garante que o TESTE e a PRODUÇÃO usem exatamente a mesma lógica.
// ══════════════════════════════════════════════════════════════════

// Normaliza um número/JID: remove sufixos, espaços, +, traços, parênteses
function normPhone(j = "") {
  return String(j)
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@lid$/i, "")
    .replace(/@.*$/, "")
    .replace(/[^\d]/g, ""); // mantém só dígitos
}

// {{nome}} = PRIMEIRO nome (resolvido da agenda do usuário, não do perfil do WhatsApp)
function firstName(full = "") {
  const t = String(full || "").trim().replace(/\s+/g, " ");
  return t && t !== "." ? t.split(" ")[0] : "";
}
// Variantes BR do número (com/sem o 9º dígito) para casar com a agenda
function brVariants(d = "") {
  const x = String(d).replace(/\D/g, "");
  if (!x) return [];
  const out = new Set([x]);
  if (x.length === 13 && x.startsWith("55") && x[4] === "9") out.add(x.slice(0, 4) + x.slice(5));
  if (x.length === 12 && x.startsWith("55")) out.add(x.slice(0, 4) + "9" + x.slice(4));
  return [...out];
}
// Busca o contato na AGENDA (coleção Contact) e devolve o 1º nome
async function agendaFirstName(candidates) {
  const variants = new Set();
  for (const c of candidates) for (const v of brVariants(c)) variants.add(v);
  if (variants.size === 0) return "";
  try {
    const fc = await Contact.findOne({ phoneE164: { $in: [...variants] } });
    if (fc && firstName(fc.name)) return firstName(fc.name);
  } catch (e) { /* ignora */ }
  return "";
}

// Normaliza texto para comparação: minúsculas + remove espaços extras das pontas
// === [AUTOFLOW PATCH v2] ===
function normText(t = "") {
  return String(t)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
const NEGATIONS = ["nao", "nunca", "jamais", "sem", "tampouco"];
function isNegatedBefore(msgNorm, idx) {
  const before = msgNorm.slice(0, idx).trim().split(" ").slice(-3);
  return before.some(w => NEGATIONS.includes(w));
}
function matchLoose(msgNorm, kw) {
  const shortKw = kw.length <= 3;
  let from = 0, idx;
  while ((idx = msgNorm.indexOf(kw, from)) !== -1) {
    const okBoundary = !shortKw || (!/[a-z0-9]/.test(msgNorm[idx - 1] || "") && !/[a-z0-9]/.test(msgNorm[idx + kw.length] || ""));
    if (okBoundary && !isNegatedBefore(msgNorm, idx)) return true;
    from = idx + kw.length;
  }
  return false;
}
function matchStrict(msgNorm, kw) {
  const special = ".*+?^=!:${}()|[]/\\";
  let esc = "";
  for (const ch of kw) { esc += special.indexOf(ch) !== -1 ? "\\" + ch : ch; }
  const re = new RegExp("(^|[.,!?;:]\\s*)" + esc + "(\\s*[.,!?;:]|$)");
  const m = re.exec(msgNorm);
  if (!m) return false;
  return !isNegatedBefore(msgNorm, m.index + m[1].length);
}
function keywordMatches(msgNorm, ruleKwRaw) {
  const parts = String(ruleKwRaw).split(/[,|]/).map(x => x.trim()).filter(Boolean);
  for (const part of parts) {
    const strict = (part.length >= 2) && ((part[0] === "'" && part[part.length-1] === "'") || (part[0] === '"' && part[part.length-1] === '"'));
    const core = strict ? part.slice(1, -1) : part;
    const kw = normText(core);
    if (!kw) continue;
    if (strict ? matchStrict(msgNorm, kw) : matchLoose(msgNorm, kw)) return true;
  }
  return false;
}
function ruleSpecificity(rule){
  const parts=String(rule.keyword||"").split(/[,||]/).map(x=>x.trim()).filter(Boolean);
  let best=0;
  for(const part of parts){
    const strict=(part.length>=2)&&((part[0]==='"'&&part[part.length-1]==='"')||(part[0]==="'"&&part[part.length-1]==="'"));
    const core=strict?part.slice(1,-1):part;
    const kw=normText(core);
    if(kw&&kw.length>best)best=kw.length;
  }
  return best;
}
// === [/AUTOFLOW PATCH v2] ===

// Verifica se o horário atual está dentro da faixa (trata virada de meia-noite)
function timeInRange(start = "00:00", end = "23:59") {
  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  const s = (sh || 0) * 60 + (sm || 0);
  const e = (eh || 0) * 60 + (em || 0);
  return s > e ? (curMin >= s || curMin <= e) : (curMin >= s && curMin <= e);
}

// Avalia uma regra contra uma mensagem. Retorna o motivo do skip (ou null se casa).
// candidates = Set de números normalizados que identificam o remetente.
function evaluateRule(rule, msgText, candidates) {
  const ruleKw    = normText(rule.keyword);
  const msgNorm   = normText(msgText);
  const rulePhone = normPhone(rule.targetPhone);

  // Contato específico: precisa bater com algum id do remetente
  // Match tolerante: igualdade exata OU mesmos ultimos 8 digitos
  // (resolve nono digito BR e LID nao resolvido)
  if (rulePhone) {
    const tail = (n) => String(n || '').slice(-8);
    const rt = tail(rulePhone);
    const hit = candidates.has(rulePhone) ||
      (rt.length === 8 && [...candidates].some(c => tail(c) === rt));
    if (!hit) return "numero_diferente";
  }
  // Horário
  if (!timeInRange(rule.startTime, rule.endTime)) return "fora_horario";
  // Palavra-chave (já normalizada dos dois lados → espaço no fim não atrapalha)
  if (!keywordMatches(msgNorm, rule.keyword)) return "keyword_nao_encontrada";
  return null; // casou!
}

// ── Job diário de notificações de assinatura ──────────────────────
// Agenda uma verificação todo dia às 08:00 BRT
async function scheduleSubscriptionCheck() {
  try {
    await queue.upsertJobScheduler(
      "daily-subscription-check",
      { pattern: "0 8 * * *", tz: "America/Sao_Paulo" },
      { name: "check-subscriptions", data: {}, opts: { attempts: 3, removeOnComplete: 7, removeOnFail: 7 } }
    );
    // Job diário da esteira semanal (mesma hora)
    await queue.upsertJobScheduler(
      "daily-pipeline-weekly",
      { pattern: "5 8 * * *", tz: "America/Sao_Paulo" },
      { name: "pipeline-weekly-check", data: {}, opts: { attempts: 3, removeOnComplete: 7, removeOnFail: 7 } }
    );
    console.log("✅ Jobs diários agendados (08:00 e 08:05 BRT)");
  } catch (e) {
    console.warn("⚠️  Não foi possível agendar jobs diários:", e.message);
  }
}
scheduleSubscriptionCheck();

// ── Auth ──────────────────────────────────────────────────────────
router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const u = await User.findOne({ email });
  if (!u) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  const token = jwt.sign({ email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { email: u.email, role: u.role } });
});

// — Trocar senha do próprio usuário logado
router.post("/auth/change-password", auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "missing_fields" });
    if (String(newPassword).length < 6) return res.status(400).json({ error: "weak_password", message: "A nova senha deve ter ao menos 6 caracteres." });
    const u = await User.findOne({ email: req.user.email });
    if (!u) return res.status(404).json({ error: "user_not_found" });
    const ok = await bcrypt.compare(currentPassword, u.passwordHash);
    if (!ok) return res.status(401).json({ error: "wrong_current_password", message: "Senha atual incorreta." });
    u.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await u.save();
    try { await Audit.create({ who: req.user.email, action: "CHANGE_PASSWORD", entity: u.email, detail: "Trocou a própria senha" }); } catch (_) {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error", message: e.message });
  }
});

// ── Dashboard (enriquecido) ───────────────────────────────────────
router.get("/dashboard", auth, async (_req, res) => {
  const [recurringActive, recurringTotal, contacts, templates, recentAudit] = await Promise.all([
    Recurring.countDocuments({ enabled: true }),
    Recurring.countDocuments({}),
    Contact.countDocuments({}),
    Template.countDocuments({}),
    Audit.find({}).sort({ at: -1 }).limit(5),
  ]);

  // Próximas 3 automações que vão disparar
  const activeRecs = await Recurring.find({ enabled: true }).populate("templateId").limit(20);
  const upcoming = [];
  for (const r of activeRecs) {
    try {
      const it = cronParser.parseExpression(r.pattern, { tz: r.tz });
      const next = it.next().toDate();
      upcoming.push({ name: r.name, next, tz: r.tz, templateName: r.templateId?.name || "—" });
    } catch {}
  }
  upcoming.sort((a, b) => a.next - b.next);

  const pipelineActive = await PipelineContact.countDocuments({ status: { $nin: ["ended"] } });

  res.json({
    recurringActive,
    recurringTotal,
    contacts,
    templates,
    recentAudit,
    upcoming: upcoming.slice(0, 5),
    pipelineActive,
  });
});

// ── WhatsApp ──────────────────────────────────────────────────────
router.get("/whatsapp/status", auth, async (_req, res) => {
  const r = await fetch(`${process.env.WA_GATEWAY_URL}/status`);
  res.status(r.status).json(await r.json());
});

router.get("/whatsapp/qr", auth, async (_req, res) => {
  const r = await fetch(`${process.env.WA_GATEWAY_URL}/qr`);
  res.status(r.status).json(await r.json());
});

router.post("/whatsapp/disconnect", auth, async (_req, res) => {
  try {
    const r = await fetch(`${process.env.WA_GATEWAY_URL}/logout`, { method: "POST" });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// GET /whatsapp/contacts?q=busca&limit=50
router.get("/whatsapp/contacts", auth, async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.q)     params.set('q', req.query.q);
    if (req.query.limit) params.set('limit', req.query.limit);
    const r = await fetch(`${process.env.WA_GATEWAY_URL}/contacts?${params}`);
    res.status(r.status).json(await r.json());
  } catch {
    res.json([]);
  }
});

// ── Templates ─────────────────────────────────────────────────────
router.get("/templates", auth, async (_req, res) =>
  res.json(await Template.find({}).sort({ createdAt: -1 }))
);

router.post("/templates", auth, async (req, res) => {
  const { name, body, vars } = req.body;
  if (!name || !body) return res.status(400).json({ error: "name_and_body_required" });
  const doc = await Template.create({ name, body, vars: vars || [] });
  await Audit.create({ who: req.user.email, action: "CREATE_TEMPLATE", entity: String(doc._id), detail: `Criou template: ${name}`, ok: true });
  res.json(doc);
});

router.put("/templates/:id", auth, async (req, res) => {
  const { name, body, vars } = req.body;
  const doc = await Template.findByIdAndUpdate(req.params.id, { name, body, vars: vars || [] }, { new: true });
  if (!doc) return res.status(404).json({ error: "not_found" });
  await Audit.create({ who: req.user.email, action: "UPDATE_TEMPLATE", entity: String(doc._id), detail: `Editou template: ${name}`, ok: true });
  res.json(doc);
});

router.delete("/templates/:id", auth, async (req, res) => {
  const doc = await Template.findByIdAndDelete(req.params.id);
  if (!doc) return res.status(404).json({ error: "not_found" });
  await Audit.create({ who: req.user.email, action: "DELETE_TEMPLATE", entity: req.params.id, detail: `Deletou template: ${doc.name}`, ok: true });
  res.json({ ok: true });
});

// POST /templates/:id/clone — clona um template
router.post("/templates/:id/clone", auth, async (req, res) => {
  const original = await Template.findById(req.params.id);
  if (!original) return res.status(404).json({ error: "not_found" });
  const clone = await Template.create({
    name: `${original.name} (cópia)`,
    body: original.body,
    vars: original.vars,
  });
  await Audit.create({ who: req.user.email, action: "CLONE_TEMPLATE", entity: String(clone._id), detail: `Clonou template: ${original.name}`, ok: true });
  res.json(clone);
});

// ── Contacts ──────────────────────────────────────────────────────
router.get("/contacts", auth, async (_req, res) =>
  res.json(await Contact.find({}).sort({ createdAt: -1 }))
);

router.post("/contacts", auth, async (req, res) => {
  const { phoneE164, name, tags, subscriptionStart, subscriptionEnd, subscriptionNotes } = req.body;
  if (!phoneE164) return res.status(400).json({ error: "phoneE164_required" });
  const existing = await Contact.findOne({ phoneE164 });
  if (existing) return res.status(409).json({ error: "already_exists", contact: existing });
  const doc = await Contact.create({
    phoneE164,
    name: name || "",
    tags: tags || [],
    optIn: true,
    subscriptionStart: subscriptionStart || null,
    subscriptionEnd:   subscriptionEnd   || null,
    subscriptionNotes: subscriptionNotes || "",
  });
  res.json(doc);
});

router.put("/contacts/:id", auth, async (req, res) => {
  const { name, tags, optIn, subscriptionStart, subscriptionEnd, subscriptionNotes } = req.body;
  const doc = await Contact.findByIdAndUpdate(req.params.id, {
    name, tags, optIn,
    subscriptionStart: subscriptionStart || null,
    subscriptionEnd:   subscriptionEnd   || null,
    subscriptionNotes: subscriptionNotes || "",
  }, { new: true });
  if (!doc) return res.status(404).json({ error: "not_found" });
  res.json(doc);
});

router.delete("/contacts/:id", auth, async (req, res) => {
  await Contact.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ── Métricas de Assinaturas ───────────────────────────────────────
router.get("/subscriptions/metrics", auth, async (_req, res) => {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7d  = new Date(today); in7d.setDate(today.getDate() + 7);
  const in1d  = new Date(today); in1d.setDate(today.getDate() + 1);

  const [active, expiring7d, expiringToday, expired, noSub] = await Promise.all([
    // Ativos: endDate existe e é futuro
    Contact.countDocuments({ subscriptionEnd: { $gt: today } }),
    // Vencendo em até 7 dias (a partir de amanhã)
    Contact.find({
      subscriptionEnd: { $gte: in1d, $lte: in7d }
    }).sort({ subscriptionEnd: 1 }).limit(50),
    // Vencendo hoje
    Contact.find({
      subscriptionEnd: { $gte: today, $lt: in1d }
    }).sort({ subscriptionEnd: 1 }).limit(50),
    // Vencidos
    Contact.countDocuments({ subscriptionEnd: { $lte: today } }),
    // Sem assinatura configurada
    Contact.countDocuments({ subscriptionEnd: null }),
  ]);

  // Total de contatos
  const total = await Contact.countDocuments({});

  res.json({
    total,
    active,
    expired,
    noSub,
    expiring7d,
    expiringToday,
    expiring7dCount: expiring7d.length,
    expiringTodayCount: expiringToday.length,
  });
});

// Contatos vencendo em N dias (para listar na view)
router.get("/subscriptions/expiring", auth, async (req, res) => {
  const days = parseInt(req.query.days || '30', 10);
  const today = new Date(); today.setHours(0,0,0,0);
  const future = new Date(today); future.setDate(today.getDate() + days);

  const contacts = await Contact.find({
    subscriptionEnd: { $gte: today, $lte: future }
  }).sort({ subscriptionEnd: 1 }).limit(200);

  res.json(contacts);
});

// Contatos vencidos
router.get("/subscriptions/expired", auth, async (_req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const contacts = await Contact.find({
    subscriptionEnd: { $lt: today }
  }).sort({ subscriptionEnd: -1 }).limit(200);
  res.json(contacts);
});

// ── Recurring ─────────────────────────────────────────────────────
router.get("/recurring", auth, wrap(async (_req, res) => {
  const list = await Recurring.find({}).sort({ createdAt: -1 }).populate("templateId");
  res.json(list);
}));

router.post("/recurring", auth, wrap(async (req, res) => {
  const doc = await Recurring.create(req.body);
  if (doc.enabled) await upsertRecurringScheduler(queue, doc);
  await Audit.create({ who: req.user.email, action: "CREATE_RECURRING", entity: String(doc._id), detail: `Criou: ${doc.name}`, ok: true });
  res.json(doc);
}));

router.put("/recurring/:id", auth, wrap(async (req, res) => {
  const { _id, createdAt, ...data } = req.body;
  const doc = await Recurring.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!doc) return res.status(404).json({ error: "not_found" });
  if (doc.enabled) await upsertRecurringScheduler(queue, doc);
  else await removeRecurringScheduler(queue, req.params.id);
  await Audit.create({ who: req.user.email, action: "UPDATE_RECURRING", entity: String(doc._id), detail: `Editou: ${doc.name}`, ok: true });
  res.json(doc);
}));

router.post("/recurring/:id/pause", auth, wrap(async (req, res) => {
  await Recurring.findByIdAndUpdate(req.params.id, { enabled: false });
  await removeRecurringScheduler(queue, req.params.id);
  res.json({ ok: true });
}));

router.post("/recurring/:id/resume", auth, wrap(async (req, res) => {
  const doc = await Recurring.findByIdAndUpdate(req.params.id, { enabled: true }, { new: true });
  await upsertRecurringScheduler(queue, doc);
  res.json({ ok: true });
}));

router.delete("/recurring/:id", auth, wrap(async (req, res) => {
  const doc = await Recurring.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "not_found" });
  await removeRecurringScheduler(queue, req.params.id);
  await Recurring.findByIdAndDelete(req.params.id);
  await Audit.create({ who: req.user.email, action: "DELETE_RECURRING", entity: req.params.id, detail: `Deletou: ${doc.name}`, ok: true });
  res.json({ ok: true });
}));

// POST /recurring/:id/clone — clona uma regra de automação
router.post("/recurring/:id/clone", auth, wrap(async (req, res) => {
  const original = await Recurring.findById(req.params.id);
  if (!original) return res.status(404).json({ error: "not_found" });
  const { _id, createdAt, ...data } = original.toObject();
  const clone = await Recurring.create({
    ...data,
    name: `${original.name} (cópia)`,
    enabled: false, // começa pausada para revisão
  });
  await Audit.create({ who: req.user.email, action: "CLONE_RECURRING", entity: String(clone._id), detail: `Clonou automação: ${original.name}`, ok: true });
  res.json(clone);
}));

router.post("/recurring/preview", auth, wrap(async (req, res) => {
  const { pattern, tz, count = 5 } = req.body;
  try {
    const it = cronParser.parseExpression(pattern, { tz });
    const runs = [];
    for (let i = 0; i < count; i++) runs.push(it.next().toDate().toISOString());
    res.json({ runs });
  } catch (e) {
    res.status(400).json({ error: "invalid_cron", message: e.message });
  }
}));

// ── Scheduled Messages ────────────────────────────────────────────
// Listar agendamentos
router.get("/scheduled", auth, async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const list = await ScheduledMessage.find(filter)
    .sort({ scheduledAt: 1 })
    .populate("templateId")
    .limit(200);
  res.json(list);
});

// Criar agendamento
router.post("/scheduled", auth, async (req, res) => {
  const { phoneE164, contactName, message, templateId, scheduledAt, name } = req.body;
  if (!phoneE164 || !message || !scheduledAt) {
    return res.status(400).json({ error: "phoneE164, message e scheduledAt são obrigatórios" });
  }

  const scheduledDate = new Date(scheduledAt);
  if (scheduledDate <= new Date()) {
    return res.status(400).json({ error: "scheduledAt deve ser uma data futura" });
  }

  // Criar registro no banco
  const doc = await ScheduledMessage.create({
    name: name || "",
    phoneE164,
    contactName: contactName || "",
    message,
    templateId: templateId || null,
    scheduledAt: scheduledDate,
    status: "pending",
    createdBy: req.user.email,
  });

  // Agendar job no BullMQ com delay exato
  const delay = scheduledDate.getTime() - Date.now();
  const job = await queue.add(
    "send-scheduled",
    { scheduledId: String(doc._id) },
    {
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    }
  );

  // Salvar ID do job para cancelamento futuro
  await ScheduledMessage.findByIdAndUpdate(doc._id, {
    bullJobId: job.id,
    status: "queued",
  });

  await Audit.create({
    who: req.user.email,
    action: "CREATE_SCHEDULED",
    entity: String(doc._id),
    detail: `Agendou mensagem para ${phoneE164} em ${scheduledDate.toLocaleString("pt-BR")}`,
    ok: true,
  });

  res.json({ ...doc.toObject(), bullJobId: job.id, status: "queued" });
});

// Cancelar agendamento
router.post("/scheduled/:id/cancel", auth, async (req, res) => {
  const doc = await ScheduledMessage.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "not_found" });
  if (doc.status === "sent") return res.status(400).json({ error: "Mensagem já foi enviada" });

  // Tentar remover job da fila
  if (doc.bullJobId) {
    try {
      const job = await queue.getJob(doc.bullJobId);
      if (job) await job.remove();
    } catch {}
  }

  await ScheduledMessage.findByIdAndUpdate(req.params.id, { status: "cancelled" });

  await Audit.create({
    who: req.user.email,
    action: "CANCEL_SCHEDULED",
    entity: String(doc._id),
    detail: `Cancelou agendamento para ${doc.phoneE164}`,
    ok: true,
  });

  res.json({ ok: true });
});

// Deletar agendamento (apenas cancelados, enviados ou falhos)
router.delete("/scheduled/:id", auth, async (req, res) => {
  const doc = await ScheduledMessage.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: "not_found" });

  if (doc.status === "pending" || doc.status === "queued") {
    // Cancelar primeiro
    if (doc.bullJobId) {
      try {
        const job = await queue.getJob(doc.bullJobId);
        if (job) await job.remove();
      } catch {}
    }
  }

  await ScheduledMessage.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// POST /auto-reply/test — simula uma mensagem recebida e mostra qual regra ativaria
router.post("/auto-reply/test", auth, async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error: "phone_e_text_obrigatorios" });

  // Mesmo conjunto de candidatos que a produção montaria
  const candidates = new Set([normPhone(phone)].filter(Boolean));

  const rules = await AutoReply.find({ active: true }).sort({ targetPhone: -1, createdAt: 1 });

  let matched = null, bestScoreT = -1;
  const checked = [];

  for (const rule of rules) {
    const skip_reason = evaluateRule(rule, text, candidates);
    checked.push({
      keyword:     rule.keyword,
      targetPhone: rule.targetPhone || '(todos)',
      targetName:  rule.targetName || '',
      active:      rule.active,
      skip_reason,
    });
    if (!skip_reason) {
      const score = ruleSpecificity(rule);
      if (score > bestScoreT) { bestScoreT = score; matched = rule; }
    }
  }

  res.json({
    input:   { phone: normPhone(phone), text: normText(text) },
    matched: matched ? { keyword: matched.keyword, reply: matched.reply } : null,
    checked,
    total_rules: rules.length,
  });
});

// ── Auto-Reply CRUD ───────────────────────────────────────────────
router.get("/auto-reply", auth, async (_req, res) =>
  res.json(await AutoReply.find({}).sort({ createdAt: -1 }))
);

router.post("/auto-reply", auth, async (req, res) => {
  const { keyword, reply, targetPhone, targetName, startTime, endTime, active } = req.body;
  if (!keyword || !reply) return res.status(400).json({ error: "keyword_e_reply_obrigatorios" });
  const doc = await AutoReply.create({
    keyword:     String(keyword).trim(),       // remove espaços das pontas
    reply,
    targetPhone: normPhone(targetPhone || ""),  // só dígitos, consistente
    targetName:  targetName  || "",
    startTime:   startTime   || "00:00",
    endTime:     endTime     || "23:59",
    active:      active !== false,
    createdBy:   req.user.email,
  });
  await Audit.create({ who: req.user.email, action: "CREATE_AUTO_REPLY", entity: String(doc._id), detail: `Regra: "${keyword}"`, ok: true });
  res.json(doc);
});

router.put("/auto-reply/:id", auth, async (req, res) => {
  const { keyword, reply, targetPhone, targetName, startTime, endTime, active } = req.body;
  const doc = await AutoReply.findByIdAndUpdate(req.params.id,
    { keyword: String(keyword||"").trim(), reply, targetPhone: normPhone(targetPhone||""), targetName: targetName||"", startTime: startTime||"00:00", endTime: endTime||"23:59", active },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: "not_found" });
  res.json(doc);
});

router.post("/auto-reply/:id/clone", auth, async (req, res) => {
  const orig = await AutoReply.findById(req.params.id);
  if (!orig) return res.status(404).json({ error: "not_found" });
  const clone = await AutoReply.create({
    keyword: orig.keyword + " (cópia)", reply: orig.reply,
    targetPhone: orig.targetPhone, targetName: orig.targetName, startTime: orig.startTime,
    endTime: orig.endTime, active: false, createdBy: req.user.email,
  });
  await Audit.create({ who: req.user.email, action: "CLONE_AUTO_REPLY", entity: String(clone._id), detail: `Clonou: "${orig.keyword}"`, ok: true });
  res.json(clone);
});

router.delete("/auto-reply/:id", auth, async (req, res) => {
  await AutoReply.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ── Webhook interno — recebe mensagens do wa-gateway ─────────────
// ── Upload de mídia (áudio/imagem/etc) -> volume compartilhado /media ──
const MEDIA_DIR = process.env.MEDIA_DIR || "/media";
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch (e) { /* ok */ }
const uploadMedia = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || "") || "").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
      cb(null, crypto.randomBytes(8).toString("hex") + ext);
    },
  }),
  limits: { fileSize: 32 * 1024 * 1024 },
});
router.post("/upload-media", auth, uploadMedia.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "sem_arquivo" });
  res.json({ url: "local:" + req.file.filename, mediaId: req.file.filename });
});

// Chamado pelo gateway quando chega mensagem no WhatsApp
router.post("/internal/message", async (req, res) => {
  const { from, text, pushName, fromLid, fromReal, replyTo } = req.body;
  if (!from || !text) return res.status(400).json({ error: "from_e_text_obrigatorios" });

  // Conjunto de números que identificam o remetente (número real + LID)
  const phone = normPhone(from);
  const candidates = new Set([phone, normPhone(fromLid), normPhone(fromReal)].filter(Boolean));
  console.log(`📨 /internal/message: from=${phone} (ids: ${[...candidates].join(",")}) text="${text}"`);

  // AUTO-CADASTRO na agenda (Clientes): quem te manda mensagem entra com o NÚMERO REAL.
  // Usa fromReal (decodificado do LID); pula grupos e LIDs sem número real.
  // NÃO sobrescreve contato existente — preserva o nome que VOCÊ definiu.
  try {
    const isLid = /@lid$/i.test(String(from));
    const isGroup = /@g\.us$/i.test(String(from));
    const realPhone = normPhone(fromReal) || (isLid ? "" : phone);
    if (!isGroup && /^55\d{10,11}$/.test(realPhone)) {
      const exists = await Contact.findOne({ phoneE164: { $in: brVariants(realPhone) } });
      if (!exists) {
        await Contact.create({ phoneE164: realPhone, name: (pushName || "").trim(), tags: [], optIn: true });
        console.log(`🆕 Contato auto-cadastrado na agenda: ${realPhone} (${pushName || "sem nome"})`);
      }
    }
  } catch (e) { /* duplicado/erro de schema — ignora */ }

  const rules = await AutoReply.find({ active: true }).sort({ targetPhone: -1, createdAt: 1 });

  let matched = null, bestScore = -1;
  for (const rule of rules) {
    if (evaluateRule(rule, text, candidates)) continue;
    const score = ruleSpecificity(rule);
    if (score > bestScore) { bestScore = score; matched = rule; }
  }

  if (matched) {
    console.log(`✅ Regra "${matched.keyword}" ativada para ${phone}`);
    try {
      // AUTO_REPLY_DELAY: atraso humano aleatorio 12-20s antes de responder
        const _arDelay = 12000 + Math.floor(Math.random() * 8001);
        console.log("[auto-reply] aguardando " + (_arDelay/1000).toFixed(1) + "s para " + phone);
        await new Promise(function(r){ setTimeout(r, _arDelay); });
        const agenda = await agendaFirstName(candidates);
      const name = agenda || firstName(matched.targetName) || phone;
      const replyText = render(matched.reply || "", { nome: name });
      const sendResp = await fetch(`${process.env.WA_GATEWAY_URL}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, text: replyText, replyTo: replyTo || from }),
      });
      const sendResult = await sendResp.json().catch(() => ({}));
      console.log(`📤 Resposta enviada: ${JSON.stringify(sendResult)}`);
      await Audit.create({
        who: "system", action: "AUTO_REPLY_SENT",
        entity: String(matched._id),
        detail: `Regra "${matched.keyword}" → ${phone}`,
        ok: true,
      });
    } catch (e) {
      console.error(`❌ Erro ao enviar auto-reply: ${e.message}`);
      await Audit.create({ who: "system", action: "AUTO_REPLY_FAIL", entity: String(matched._id), detail: e.message, ok: false });
    }
  } else {
    console.log(`⚠️ Nenhuma regra ativa para: from=${phone} text="${text}"`);
  }

  res.json({ ok: true, matched: matched ? matched.keyword : null });
});

// ══════════════════════════════════════════════════════════════════
// ONBOARDING CONFIG
// ══════════════════════════════════════════════════════════════════

// Retorna a config (cria default se não existir)
router.get("/onboarding/config", auth, async (_req, res) => {
  let cfg = await OnboardingConfig.findOne();
  if (!cfg) cfg = await OnboardingConfig.create({ steps: [] });
  res.json(cfg);
});

router.put("/onboarding/config", auth, async (req, res) => {
  let cfg = await OnboardingConfig.findOne();
  if (!cfg) cfg = new OnboardingConfig();
  Object.assign(cfg, req.body);
  cfg.updatedAt = new Date();
  await cfg.save();
  res.json(cfg);
});

// ══════════════════════════════════════════════════════════════════
// PIPELINE CONFIG (textos das semanas)
// ══════════════════════════════════════════════════════════════════

router.get("/pipeline/config", auth, async (_req, res) => {
  let cfg = await PipelineConfig.findOne();
  if (!cfg) cfg = await PipelineConfig.create({
    weeks: [
      { week: 1, dayTrigger: 7,  sendTime: "08:00", message: "", mediaUrl: "" },
      { week: 2, dayTrigger: 14, sendTime: "08:00", message: "", mediaUrl: "" },
      { week: 3, dayTrigger: 21, sendTime: "08:00", message: "", mediaUrl: "" },
    ],
    renewalMessage: "",
  });
  res.json(cfg);
});

router.put("/pipeline/config", auth, async (req, res) => {
  let cfg = await PipelineConfig.findOne();
  if (!cfg) cfg = new PipelineConfig();
  Object.assign(cfg, req.body);
  cfg.updatedAt = new Date();
  await cfg.save();
  res.json(cfg);
});

// ══════════════════════════════════════════════════════════════════
// PIPELINE CONTACTS — gestão da esteira
// ══════════════════════════════════════════════════════════════════

// Listar clientes na esteira (com filtro de status)
router.get("/pipeline/contacts", auth, async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const list = await PipelineContact.find(filter)
    .sort({ enteredAt: -1 })
    .limit(200);
  res.json(list);
});

// Métricas da esteira para o dashboard
router.get("/pipeline/metrics", auth, async (_req, res) => {
  const [onboarding, week1, week2, week3, renewed, ended, total] = await Promise.all([
    PipelineContact.countDocuments({ status: "onboarding" }),
    PipelineContact.countDocuments({ status: "week1" }),
    PipelineContact.countDocuments({ status: "week2" }),
    PipelineContact.countDocuments({ status: "week3" }),
    PipelineContact.countDocuments({ status: "renewed" }),
    PipelineContact.countDocuments({ status: "ended" }),
    PipelineContact.countDocuments({}),
  ]);
  res.json({ onboarding, week1, week2, week3, renewed, ended, total });
});

// Adicionar cliente à esteira (dispara onboarding)
router.post("/pipeline/contacts", auth, async (req, res) => {
  const { contactId, phoneE164, name } = req.body;
  if (!phoneE164) return res.status(400).json({ error: "phoneE164_required" });

  // Verificar se já está na esteira
  const dupFilter = contactId
      ? { contactId, status: { $nin: ["ended"] } }
      : { phoneE164, status: { $nin: ["ended"] } };
    const existing = await PipelineContact.findOne(dupFilter);
  if (existing) return res.status(409).json({ error: "already_in_pipeline", pipeline: existing });

  const enteredAt = new Date();
  const pc = await PipelineContact.create({
    contactId, phoneE164, name: name || "",
    enteredAt, status: "onboarding",
  });

  // Verificar se onboarding está ativo
  const cfg = await OnboardingConfig.findOne();
  if (cfg?.active && cfg.steps?.length > 0) {
    const delayMs = (cfg.delayMin || 30) * 60 * 1000;
    const job = await queue.add(
      "pipeline-onboarding",
      { pipelineContactId: String(pc._id) },
      { delay: delayMs, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
    await PipelineContact.findByIdAndUpdate(pc._id, { onboardingBullJobId: String(job.id) });
  }

  await Audit.create({
    who: req.user.email, action: "PIPELINE_ADD",
    entity: String(pc._id), detail: `${name || phoneE164} entrou na esteira`, ok: true,
  });

  res.json(pc);
});

// Marcar cliente como renovado (reinicia esteira)

// === IMPORT: restauração idempotente da esteira (upsert por phoneE164) ===
router.post("/pipeline/contacts/import", auth, async (req, res) => {
  try {
    const body = req.body;
    const items = Array.isArray(body) ? body : (Array.isArray(body?.contacts) ? body.contacts : (Array.isArray(body?.items) ? body.items : []));
    if (!Array.isArray(items)) return res.status(400).json({ error: "invalid_payload" });
    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const raw of items) {
      try {
        const { _id, __v, createdAt, updatedAt, ...doc } = raw || {};
        if (!doc.phoneE164) { skipped++; continue; }
        const existing = await PipelineContact.findOne({ phoneE164: doc.phoneE164 });
        if (existing) {
          await PipelineContact.updateOne({ _id: existing._id }, { $set: doc });
          updated++;
        } else {
          await PipelineContact.create(doc);
          inserted++;
        }
      } catch (e) {
        errors.push({ phoneE164: raw?.phoneE164, message: e.message });
      }
    }
    try { await Audit.create({ who: req.user.email, action: "PIPELINE_IMPORT", entity: "pipeline", detail: `import ${inserted} novo(s), ${updated} atualizado(s)`, ok: errors.length === 0 }); } catch (_) {}
    return res.json({ inserted, updated, skipped, failed: errors.length, errors });
  } catch (e) {
    return res.status(500).json({ error: "import_failed", message: e.message });
  }
});
router.post("/pipeline/contacts/:id/renew", auth, async (req, res) => {
  const pc = await PipelineContact.findById(req.params.id);
  if (!pc) return res.status(404).json({ error: "not_found" });

  const now = new Date();
  await PipelineContact.findByIdAndUpdate(req.params.id, {
    status: "onboarding",
    currentWeek: 0,
    enteredAt: now,
    renewedAt: now,
    weeksSent: [],
    onboardingBullJobId: "",
  });

  // Disparar onboarding novamente
  const cfg = await OnboardingConfig.findOne();
  if (cfg?.active && cfg.steps?.length > 0) {
    const delayMs = (cfg.delayMin || 30) * 60 * 1000;
    const job = await queue.add(
      "pipeline-onboarding",
      { pipelineContactId: pc._id.toString() },
      { delay: delayMs, attempts: 3 }
    );
    await PipelineContact.findByIdAndUpdate(req.params.id, { onboardingBullJobId: String(job.id) });
  }

  await Audit.create({
    who: req.user.email, action: "PIPELINE_RENEW",
    entity: String(pc._id), detail: `${pc.name || pc.phoneE164} renovou`, ok: true,
  });

  res.json({ ok: true });
});

// Encerrar cliente da esteira
router.post("/pipeline/contacts/:id/end", auth, async (req, res) => {
  await PipelineContact.findByIdAndUpdate(req.params.id, {
    status: "ended", endedAt: new Date(),
  });
  res.json({ ok: true });
});

// Remover da esteira
router.delete("/pipeline/contacts/:id", auth, async (req, res) => {
  await PipelineContact.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ── Audit ─────────────────────────────────────────────────────────
router.get("/audit", auth, async (_req, res) =>
  res.json(await Audit.find({}).sort({ at: -1 }).limit(200))
);


// ===================== BACKUP (gestao via interface) =====================
// Pasta de backups montada no container em /backups (read).
// Pedido de backup manual: cria flag em /backups/requests; um watcher
// no host executa o backup.sh (a API nao tem acesso ao docker).
const BACKUP_DIR = "/backups";
const BACKUP_REQ_DIR = "/backups/requests";
function adminOnly(req, res, next){ if(req.user && req.user.role==="admin") return next(); return res.status(403).json({ error: "forbidden_admin_only" }); }

function dirSizeBytes(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else { try { total += fs.statSync(full).size; } catch (_) {} }
    }
  } catch (_) {}
  return total;
}
function humanSize(b) {
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

router.get("/backup/list", auth, adminOnly, async (_req, res) => {
  try {
    const items = [];
    let names = [];
    try { names = fs.readdirSync(BACKUP_DIR); } catch (_) {}
    for (const name of names) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      const full = path.join(BACKUP_DIR, name);
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isDirectory()) continue;
      const bytes = dirSizeBytes(full);
      const hasManifest = fs.existsSync(path.join(full, "MANIFEST.txt"));
      const hasMongo = fs.existsSync(path.join(full, "mongo", "wa_admin.archive.gz"));
      const hasWaAuth = fs.existsSync(path.join(full, "volumes", "wa_auth.tar.gz"));
      const hasCode = fs.existsSync(path.join(full, "code"));
      items.push({
        date: name, bytes, size: humanSize(bytes),
        createdAt: st.mtime.toISOString(),
        complete: hasManifest && hasMongo && hasWaAuth && hasCode,
        parts: { code: hasCode, mongo: hasMongo, waAuth: hasWaAuth, manifest: hasManifest },
      });
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    res.json({ backups: items, count: items.length, retentionDays: 20, schedule: "05:00 BRT (diario)" });
  } catch (e) { res.status(500).json({ error: "backup_list_failed", message: e.message }); }
});

router.get("/backup/log", auth, adminOnly, async (_req, res) => {
  try {
    const p = path.join(BACKUP_DIR, "cron.log");
    let text = "";
    try { text = fs.readFileSync(p, "utf-8"); } catch (_) { text = "(sem log ainda)"; }
    const lines = text.split("\n").slice(-200).join("\n");
    res.json({ log: lines });
  } catch (e) { res.status(500).json({ error: "backup_log_failed", message: e.message }); }
});

router.post("/backup/run", auth, adminOnly, async (req, res) => {
  try {
    try { fs.mkdirSync(BACKUP_REQ_DIR, { recursive: true }); } catch (_) {}
    const id = `run_${Date.now()}`;
    fs.writeFileSync(path.join(BACKUP_REQ_DIR, `${id}.req`), `requested_by=${req.user?.email || "?"}\n`);
    try { await Audit.create({ who: req.user.email, action: "BACKUP_RUN", entity: "backup", detail: "backup manual solicitado", ok: true }); } catch (_) {}
    res.json({ ok: true, id, message: "Backup solicitado. Executa em ate ~1 min." });
  } catch (e) { res.status(500).json({ error: "backup_run_failed", message: e.message }); }
});


// Restauracao (admin). Faz um "ponto de retorno" (backup do estado atual)
// e enfileira o restore via flag-file; o watcher no host executa restore.sh.
router.post("/backup/restore", auth, adminOnly, async (req, res) => {
  try {
    const { date, target } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || ""))
      return res.status(400).json({ error: "invalid_date" });
    const allowed = ["all", "code", "mongo", "wa_auth"];
    const tgt = allowed.includes(target) ? target : "all";
    const srcDir = path.join(BACKUP_DIR, date);
    if (!fs.existsSync(srcDir))
      return res.status(404).json({ error: "backup_not_found" });
    try { fs.mkdirSync(BACKUP_REQ_DIR, { recursive: true }); } catch (_) {}
    const id = `restore_${Date.now()}`;
    fs.writeFileSync(
      path.join(BACKUP_REQ_DIR, `${id}.restore`),
      `date=${date}\ntarget=${tgt}\nrequested_by=${req.user?.email || "?"}\n`
    );
    try { await Audit.create({ who: req.user.email, action: "BACKUP_RESTORE", entity: "backup", detail: `restauracao solicitada: ${date} (${tgt})`, ok: true }); } catch (_) {}
    res.json({ ok: true, id, message: `Restauracao de ${date} (${tgt}) solicitada. Um backup de seguranca do estado atual sera feito antes. Aguarde ~1-2 min.` });
  } catch (e) { res.status(500).json({ error: "restore_failed", message: e.message }); }
});

// Status de um pedido (run/restore) para a interface acompanhar
router.get("/backup/status", auth, adminOnly, async (req, res) => {
  try {
    const id = String(req.query.id || "");
    if (!/^[a-zA-Z0-9_]+$/.test(id)) return res.status(400).json({ error: "invalid_id" });
    let status = "pending";
    const reqRun = path.join(BACKUP_REQ_DIR, `${id}.req`);
    const reqRes = path.join(BACKUP_REQ_DIR, `${id}.restore`);
    const stExt = [".req.status", ".restore.status"];
    let found = null;
    for (const e of stExt) {
      const f = path.join(BACKUP_REQ_DIR, id + e);
      if (fs.existsSync(f)) { try { found = fs.readFileSync(f, "utf-8").trim(); } catch (_) {} }
    }
    if (found) status = found;
    else if (fs.existsSync(reqRun) || fs.existsSync(reqRes)) status = "running";
    res.json({ id, status });
  } catch (e) { res.status(500).json({ error: "status_failed", message: e.message }); }
});

// AUTOFLOW_ERR_HANDLER: tratamento central de erros — responde JSON limpo
// em vez de derrubar o processo. Erros de validacao/cast viram 400.
router.use((err, req, res, next) => {
  const isBad = err && (err.name === "CastError" || err.name === "ValidationError" || err.name === "BSONError");
  const code = isBad ? 400 : 500;
  console.error("[routes] erro tratado:", err && err.message);
  if (res.headersSent) return next(err);
  res.status(code).json({ error: isBad ? "invalid_input" : "internal_error", message: err && err.message });
});

export default router;

