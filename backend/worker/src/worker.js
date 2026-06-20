import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import mongoose from "mongoose";
import fetch from "node-fetch";
import { render } from "./template.js";

const connection = new IORedis({ host: process.env.REDIS_HOST, maxRetriesPerRequest: null });
await mongoose.connect(process.env.MONGO_URL);

const m = (name, schema, col) => mongoose.model(name, new mongoose.Schema({}, { strict: false }), col);
const Recurring        = m("Recurring",        {}, "recurrings");
const Contact          = m("Contact",          {}, "contacts");
const Template         = m("Template",         {}, "templates");
const Audit            = m("Audit",            {}, "audits");
const ScheduledMessage = m("ScheduledMessage", {}, "scheduledmessages");
const PipelineContact  = m("PipelineContact",  {}, "pipelinecontacts");
const OnboardingConfig = m("OnboardingConfig", {}, "onboardingconfigs");
const PipelineConfig   = m("PipelineConfig",   {}, "pipelineconfigs");

const MIN_DELAY = Math.max(0, parseInt(process.env.MIN_MESSAGE_DELAY_MS || "2000", 10));
const JITTER    = Math.max(0, parseInt(process.env.JITTER_MS            || "1000", 10));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const delay = () => MIN_DELAY + (JITTER ? Math.floor(Math.random() * (JITTER + 1)) : 0);

function withinQuietHours(quiet, tz = "America/Sao_Paulo", now = new Date()) {
  if (!quiet?.start || !quiet?.end) return false;
  let h = now.getHours(), mi = now.getMinutes();
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const hh = p.find(x => x.type === "hour"); const mm = p.find(x => x.type === "minute");
    if (hh && mm) { h = Number(hh.value) % 24; mi = Number(mm.value); }
  } catch (e) {}
  const [sh, sm] = quiet.start.split(":").map(Number);
  const [eh, em] = quiet.end.split(":").map(Number);
  const cur = h * 60 + mi;
  const ss = sh * 60 + sm, ee = eh * 60 + em;
  return ss > ee ? (cur >= ss || cur < ee) : (cur >= ss && cur <= ee);
}
// render() centralizado em ./template.js

async function sendText(to, text) {
  const r = await fetch(`${process.env.WA_GATEWAY_URL}/send`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, text }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`gw_${r.status}:${t}`); }
  return r.json();
}

// ---- resolveName: nome do WhatsApp (gateway) > Mongo > fallback ----
let __waCache = { at: 0, map: new Map() };
async function __loadWaContacts() {
  if (Date.now() - __waCache.at < 60000 && __waCache.map.size) return __waCache.map;
  try {
    const r = await fetch(`${process.env.WA_GATEWAY_URL}/contacts`);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.contacts || []);
    const map = new Map();
    for (const c of arr) {
      const ph = String(c.phone || "").replace(/\D/g, "");
      if (ph && c.name && !map.has(ph)) map.set(ph, c.name);
    }
    __waCache = { at: Date.now(), map };
  } catch (e) { /* mantem cache anterior */ }
  return __waCache.map;
}
function firstName(full) {
  const t = (full == null ? "" : String(full)).trim().replace(/\s+/g, " ");
  return (t && t !== ".") ? t.split(" ")[0] : "";
}
async function resolveName(phone, fallback) {
  const ph = String(phone || "").replace(/\D/g, "");
  const alt = (ph.length === 13 && ph[4] === "9") ? ph.slice(0,4) + ph.slice(5)
            : (ph.length === 12 && ph.startsWith("55")) ? ph.slice(0,4) + "9" + ph.slice(4) : null;
  // 1) AGENDA (Contact) tem prioridade — é a fonte que o usuário controla
  if (ph) {
    try {
      const fc = await Contact.findOne({ phoneE164: { $in: alt ? [ph, alt] : [ph] } });
      if (fc && firstName(fc.name)) return firstName(fc.name);
    } catch (e) {}
  }
  // 2) fallback informado (ex.: nome salvo no agendamento)
  if (firstName(fallback)) return firstName(fallback);
  // 3) contatos do WhatsApp (gateway) — último recurso
  const map = await __loadWaContacts();
  if (firstName(map.get(ph))) return firstName(map.get(ph));
  if (alt && firstName(map.get(alt))) return firstName(map.get(alt));
  return "";
}


// ── Worker ────────────────────────────────────────────────────────
new Worker("wa-scheduler", async (job) => {

  // ── 1. Onboarding (30min após cadastro) ──────────────────────
  if (job.name === "pipeline-onboarding") {
    const { pipelineContactId } = job.data;
    const pc = await PipelineContact.findById(pipelineContactId);
    if (!pc || pc.status === "ended") return;

    const cfg = await OnboardingConfig.findOne();
    if (!cfg?.active || !cfg.steps?.length) return;

    console.log(`🟢 Onboarding → ${pc.phoneE164} (${cfg.steps.length} steps)`);

    for (const step of cfg.steps.sort((a,b) => a.order - b.order)) {
      if (step.delayAfterPrev > 0) await sleep(step.delayAfterPrev * 1000);

      try {
        if (step.type === "text") {
          await sendText(pc.phoneE164, render(step.content, { nome: firstName(pc.name) }));
        } else if (["image","video","document","audio"].includes(step.type) && step.mediaUrl) {
          // Enviar mídia com legenda
          const r = await fetch(`${process.env.WA_GATEWAY_URL}/send-media`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: pc.phoneE164, type: step.type, url: step.mediaUrl, caption: step.content || "" }),
          });
          if (!r.ok) throw new Error(`media_${r.status}`);
        }
        await sleep(delay());
      } catch(e) {
        console.error(`Onboarding step ${step.order} failed:`, e.message);
      }
    }

    // Avançar para semana 1
    await PipelineContact.findByIdAndUpdate(pipelineContactId, {
      status: "week1", currentWeek: 1,
    });

    await Audit.create({
      who: "system", action: "PIPELINE_ONBOARDING_DONE",
      entity: pipelineContactId,
      detail: `Onboarding concluído → ${pc.phoneE164}`, ok: true,
    });
    return;
  }

  // ── 2. Esteira semanal (job diário às 08:00) ─────────────────
  if (job.name === "pipeline-weekly-check") {
    const cfg = await PipelineConfig.findOne();
    if (!cfg?.active) return;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let totalSent = 0;

    for (const weekCfg of (cfg.weeks || []).sort((a,b) => a.week - b.week)) {
      if (!weekCfg.message && !weekCfg.mediaUrl) continue;

      const statusNeeded = weekCfg.week === 1 ? "week1"
                         : weekCfg.week === 2 ? "week2"
                         : "week3";

      // Encontrar contatos que atingiram o dia de trigger
      const triggerDate = new Date(now);
      triggerDate.setDate(now.getDate() - weekCfg.dayTrigger);

      const contacts = await PipelineContact.find({
        status: statusNeeded,
        enteredAt: { $lte: new Date(triggerDate.getTime() + 864e5) }, // até fim do dia
        // Não enviou esta semana ainda
        [`weeksSent.${weekCfg.week - 1}.week`]: { $ne: weekCfg.week },
      }).limit(500);

      for (const pc of contacts) {
        // Verificar se já enviou esta semana
        const alreadySent = (pc.weeksSent||[]).some(w => w.week === weekCfg.week);
        if (alreadySent) continue;

        // Verificar se passou o dia de trigger
        const daysPassed = Math.floor((now - new Date(pc.enteredAt)) / 864e5);
        if (daysPassed < weekCfg.dayTrigger) continue;

        try {
          const text = render(weekCfg.message, { nome: firstName(pc.name) });
          if (text) await sendText(pc.phoneE164, text);
          if (weekCfg.mediaUrl) {
            await sleep(1500);
            await fetch(`${process.env.WA_GATEWAY_URL}/send-media`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to: pc.phoneE164, type: "image", url: weekCfg.mediaUrl, caption: "" }),
            });
          }

          // Avançar status
          const nextStatus = weekCfg.week === 1 ? "week2"
                           : weekCfg.week === 2 ? "week3"
                           : "ended";

          await PipelineContact.findByIdAndUpdate(pc._id, {
            status: nextStatus,
            currentWeek: weekCfg.week,
            $push: { weeksSent: { week: weekCfg.week, sentAt: new Date(), ok: true } },
          });

          totalSent++;
          await sleep(delay());
        } catch(e) {
          await PipelineContact.findByIdAndUpdate(pc._id, {
            $push: { weeksSent: { week: weekCfg.week, sentAt: new Date(), ok: false } },
          });
          console.error(`Pipeline week${weekCfg.week} failed ${pc.phoneE164}:`, e.message);
        }
      }
    }

    // Verificar clientes no dia 30 (encerramento/renovação)
    if (cfg.renewalMessage) {
      const day30Date = new Date(now);
      day30Date.setDate(now.getDate() - 30);
      const ending = await PipelineContact.find({
        status: "week3",
        enteredAt: { $lte: new Date(day30Date.getTime() + 864e5) },
      }).limit(200);

      for (const pc of ending) {
        const daysPassed = Math.floor((now - new Date(pc.enteredAt)) / 864e5);
        if (daysPassed < 30) continue;
        try {
          await sendText(pc.phoneE164, render(cfg.renewalMessage, { nome: firstName(pc.name) }));
          await PipelineContact.findByIdAndUpdate(pc._id, { status: "ended", endedAt: new Date() });
          totalSent++;
          await sleep(delay());
        } catch(e) { console.error(`Day30 failed ${pc.phoneE164}:`, e.message); }
      }
    }

    await Audit.create({
      who: "system", action: "PIPELINE_WEEKLY_RUN",
      entity: "daily", detail: `${totalSent} mensagens da esteira enviadas`, ok: true,
    });
    console.log(`📅 Pipeline semanal: ${totalSent} mensagens enviadas`);
    return;
  }

  // ── 3. Agendamento pontual ────────────────────────────────────
  if (job.name === "send-scheduled") {
    const { scheduledId } = job.data;
    const msg = await ScheduledMessage.findById(scheduledId);
    if (!msg) return;
    if (msg.status === "cancelled") return;
    try {
      const schedName = await resolveName(msg.phoneE164, msg.contactName || msg.name || "");
        await sendText(msg.phoneE164, render(msg.message, { nome: schedName || "voce" }));
      await ScheduledMessage.findByIdAndUpdate(scheduledId, { status: "sent", sentAt: new Date() });
      await Audit.create({ who:"system", action:"EXEC_SCHEDULED", entity: scheduledId, detail:`→ ${msg.phoneE164}`, ok:true });
    } catch(err) {
      await ScheduledMessage.findByIdAndUpdate(scheduledId, { status:"failed", errorMessage: err.message });
      throw err;
    }
    return;
  }

  // ── 4. Notificações de assinatura ─────────────────────────────
  if (job.name === "check-subscriptions") {
    const n7   = process.env.NOTICE_7D    || "Olá {{nome}}! Sua assinatura vence em 7 dias.";
    const n1   = process.env.NOTICE_1D    || "Atenção {{nome}}! Sua assinatura vence amanhã.";
    const n0   = process.env.NOTICE_TODAY || "Olá {{nome}}! Sua assinatura expira hoje.";
    const today = new Date(); today.setHours(0,0,0,0);
    const d = n => { const x = new Date(today); x.setDate(x.getDate()+n); return x; };
    const groups = [
      { contacts: await Contact.find({ subscriptionEnd: { $gte: today, $lt: d(1) }, optIn:true }), tpl: n0 },
      { contacts: await Contact.find({ subscriptionEnd: { $gte: d(1), $lt: d(2) }, optIn:true }), tpl: n1 },
      { contacts: await Contact.find({ subscriptionEnd: { $gte: d(7), $lt: d(8) }, optIn:true }), tpl: n7 },
    ];
    let total = 0;
    for (const { contacts, tpl } of groups)
      for (const c of contacts) {
        try { await sendText(c.phoneE164, render(tpl, { nome: firstName(c.name) })); total++; await sleep(delay()); } catch {}
      }
    await Audit.create({ who:"system", action:"CHECK_SUBSCRIPTIONS", entity:"daily", detail:`${total} notificações`, ok:true });
    return;
  }

  // ── 5. Recorrência ────────────────────────────────────────────
  const { recurringId } = job.data;
  const rec = await Recurring.findById(recurringId);
  if (!rec || !rec.enabled) return;
  if (withinQuietHours(rec.quietHours, rec.tz)) {
    await Audit.create({ who:"system", action:"SKIP_QUIET_HOURS", entity: recurringId, detail:`${rec.quietHours?.start}-${rec.quietHours?.end}`, ok:true });
    return;
  }
  const tpl = await Template.findById(rec.templateId);
  if (!tpl) throw new Error("template_not_found");
  let targets = [];
  if (rec.targetType==="phone")   targets=[{phoneE164:rec.targetValue,name:""}];
  else if (rec.targetType==="contact") { if(/^[0-9a-fA-F]{24}$/.test(rec.targetValue)){ const c=await Contact.findById(rec.targetValue); if(c) targets=[c]; } else { targets=[{ phoneE164: String(rec.targetValue).replace(/\D/g,""), name:"" }]; } }
  else targets = await Contact.find({ tags: rec.targetValue, optIn:true }).limit(500);
  // enriquecer nome a partir do telefone quando alvo nao trouxe nome
      for (const t of targets) {
        if (t && t.phoneE164) {
          t.name = await resolveName(t.phoneE164, t.name);
        }
      }
      targets = targets.slice(0, Math.max(1, rec.throttlePerMinute||10));
  let sent = 0;
  for (const c of targets) {
    if (!c?.phoneE164) continue;
    await sendText(c.phoneE164, render(tpl.body, { nome: firstName(c.name) || "voce" }));
    sent++; await sleep(delay());
  }
  await Audit.create({ who:"system", action:"EXEC_RECURRING", entity: recurringId, detail:`${rec.name} — ${sent} msgs`, ok:true });

}, { connection, concurrency: 2 });

console.log("✅ Worker online (pipeline + onboarding + recurring)");
