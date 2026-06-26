// ════════════════════════════════════════════════════════════════════
// WA Gateway (Baileys) — base operacional reconstruída.
//
// Expõe os contratos que API e Worker já consomem:
//   GET  /status                      -> { status, hasQr }
//   GET  /qr                          -> { qr }   (data URL do QR)
//   GET  /contacts?q=&limit=          -> [{ name, phone, uncertain }]
//   POST /send       { to, text, replyTo? }
//   POST /send-media { to, type, url, caption }
//   GET  /health
// E faz POST no WEBHOOK_URL a cada mensagem recebida:
//   { from, text, pushName, fromLid, fromReal, replyTo }
//
// Fixes preservados:
//   - contatos LID não resolvidos saem com uncertain:true
//   - deduplicação por nome no /contacts
//
// Sessão persiste em AUTH_DIR (volume wa_auth) -> restaurar evita re-escanear QR.
// ════════════════════════════════════════════════════════════════════
import express from "express";
import qrcode from "qrcode";
import pino from "pino";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const PORT = process.env.PORT || 3333;
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://api:3000/api/internal/message";
const MEDIA_DIR = process.env.MEDIA_DIR || "/media";

// Resolve referência local:<arquivo> -> caminho no volume compartilhado
function resolveLocalPath(url = "") {
  if (typeof url === "string" && url.startsWith("local:")) {
    const safe = url.slice(6).replace(/[^a-zA-Z0-9._-]/g, "");
    return path.join(MEDIA_DIR, safe);
  }
  return null;
}
// Converte áudio (mp3/m4a/wav) para ogg/opus — formato de voz do WhatsApp
function toOpus(inputPath) {
  return new Promise((resolve, reject) => {
    const out = inputPath + ".voz.ogg";
    const ff = spawn("ffmpeg", ["-y", "-i", inputPath, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", out]);
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffmpeg_falhou_" + code));
      try { const b = fs.readFileSync(out); fs.unlinkSync(out); resolve(b); } catch (e) { reject(e); }
    });
  });
}

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });

// ── estado em memória ──────────────────────────────────────────────
let sock = null;
let status = "starting";
const ADMIN_ALERT_JID = "5515988008487@s.whatsapp.net";
let _lastInboundAt = Date.now();
let _lastHealthyAt = Date.now();
let _decryptFails = 0;
let _healthFails = 0;
let _lastAlertAt = 0;
let _zombie = false;
let _loggingOut = false;
const ALERT_COOLDOWN_MS = 10*60*1000;
const HEALTH_INTERVAL_MS = 60*1000;
const DECRYPT_FAIL_LIMIT = 30;          // starting | qr | connected | disconnected
let qrDataUrl = null;             // data URL do último QR
const contacts = new Map();       // jid -> { name, phone, uncertain }

// ── helpers ─────────────────────────────────────────────────────────
const onlyDigits = (s = "") => String(s).replace(/\D/g, "");
const isLid = (jid = "") => /@lid$/i.test(jid);
const phoneFromJid = (jid = "") => onlyDigits(String(jid).replace(/[:@].*$/, ""));
const jidFromPhone = (p = "") => `${onlyDigits(p)}@s.whatsapp.net`;

// === [AUTOFLOW PATCH BR9] ===
async function resolveJid(digits) {
  const d = onlyDigits(digits);
  if (!d) return jidFromPhone(d);
  const cands = [];
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") cands.push(d.slice(0,4) + d.slice(5));
  if (d.length === 12 && d.startsWith("55")) cands.push(d.slice(0,4) + "9" + d.slice(4));
  for (const cand of [d, ...cands]) {
    try {
      const r = await sock.onWhatsApp(cand);
      if (Array.isArray(r) && r[0] && r[0].exists && r[0].jid) return r[0].jid;
    } catch (e) {}
  }
  return jidFromPhone(d);
}

function rememberContact(jid, name) {
  if (!jid) return;
  const phone = phoneFromJid(jid);
  if (!phone) return;
  const uncertain = isLid(jid);                // LID não resolvido = incerto
  const prev = contacts.get(jid) || {};
  const nm = (name && String(name).trim()) || prev.name || "";
  contacts.set(jid, { name: nm, phone, uncertain: uncertain && !nm ? true : !!prev.uncertain && uncertain });
  // se temos nome, deixa de ser incerto
  if (nm) contacts.set(jid, { name: nm, phone, uncertain: false });
  else contacts.set(jid, { name: nm, phone, uncertain });
}

function listContacts(q = "", limit = 50) {
  const term = String(q || "").toLowerCase().trim();
  const out = [];
  const seenName = new Set();   // dedup por nome (fix preservado)
  const seenPhone = new Set();
  for (const c of contacts.values()) {
    if (!c.phone) continue;
    if (term && !(`${c.name}`.toLowerCase().includes(term) || c.phone.includes(onlyDigits(term)))) continue;
    const nameKey = (c.name || "").toLowerCase().trim();
    if (nameKey && seenName.has(nameKey)) continue;
    if (seenPhone.has(c.phone)) continue;
    if (nameKey) seenName.add(nameKey);
    seenPhone.add(c.phone);
    out.push({ name: c.name || "", phone: c.phone, uncertain: !!c.uncertain });
    if (out.length >= Number(limit || 50)) break;
  }
  // contatos com nome primeiro, depois incertos
  out.sort((a, b) => (a.uncertain - b.uncertain) || (b.name ? 1 : 0) - (a.name ? 1 : 0));
  return out;
}

function extractText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [FIX] corrida com timeout: garante que toda chamada de rede resolva/rejeite
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// Reenvia ao webhook com até 2 retentativas — evita perder auto-reply por falha pontual
async function postWebhook(payload, attempt = 0) {
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok && attempt < 2) { await sleep(800 * (attempt + 1)); return postWebhook(payload, attempt + 1); }
  } catch (e) {
    if (attempt < 2) { await sleep(800 * (attempt + 1)); return postWebhook(payload, attempt + 1); }
    logger.warn(`webhook falhou após retries: ${e.message}`);
  }
}

// Reconexão single-flight com backoff — impede a tempestade de reconexões (oscilação)
let reconnectTimer = null;
let reconnectAttempts = 0;
async function _sendAdminAlert(reason) {
  const now = Date.now();
  if (now - _lastAlertAt < ALERT_COOLDOWN_MS) return;
  _lastAlertAt = now;
  try {
    if (sock && status === "connected") {
      await sock.sendMessage(ADMIN_ALERT_JID, { text: "[ALERTA] AutoFlow Cadence: possivel MODO ZUMBI detectado (" + reason + "). A automacao pode nao estar respondendo. Verifique a Conexao WhatsApp." });
      logger.warn("alerta admin enviado: " + reason);
    } else {
      logger.warn("zumbi detectado mas sock indisponivel p/ alerta: " + reason);
    }
  } catch (e) { logger.error("falha ao enviar alerta admin: " + e.message); }
}
let _healthRunning = false; // [FIX] impede health-checks sobrepostos
async function _healthCheck() {
  if (_healthRunning) return;            // [FIX] reentrancia
  _healthRunning = true;
  try {
    if (status !== "connected" || !sock) { return; }
    const idleMs = Date.now() - _lastHealthyAt;
    let ok = false;
    // [FIX] ping com timeout de 10s - antes travava para sempre no modo zumbi
    try {
      await withTimeout(
        sock.query({ tag: "iq", attrs: { type: "get", xmlns: "w:p", to: "@s.whatsapp.net" } }),
        10000
      );
      ok = true;
    } catch (e) { ok = false; }
    if (ok) { _healthFails = 0; _lastHealthyAt = Date.now(); if (_zombie) { _zombie = false; logger.warn("saude restabelecida"); } return; }
    _healthFails++;
    logger.warn("health-check falhou (" + _healthFails + ") idle=" + Math.round(idleMs/1000) + "s");
    if (_healthFails >= 2) {
      _zombie = true;
      _sendAdminAlert("health-check sem resposta");
      logger.warn("watchdog: forcando reconexao por modo zumbi");
      _healthFails = 0;
      try { if (sock && sock.end) sock.end(new Error("watchdog-restart")); } catch (e) {}
      scheduleReconnect();
    }
  } catch (e) { logger.error("erro no health-check: " + e.message); }
  finally { _healthRunning = false; } // [FIX] sempre libera a trava
}
setInterval(_healthCheck, HEALTH_INTERVAL_MS);

function scheduleReconnect() {
  if (reconnectTimer || _loggingOut) return; // [FIX] nao reconecta durante logout
  const delay = Math.min(30000, 1500 * 2 ** reconnectAttempts);
  reconnectAttempts++;
  logger.warn(`reagendando conexao em ${delay}ms (tentativa ${reconnectAttempts})`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      // [FIX] descarta explicitamente o socket zumbi antes de recriar
      if (sock) { try { sock.ev.removeAllListeners(); sock.end?.(); } catch {} sock = null; }
      await start();
    } catch (e) { logger.error(e.message); scheduleReconnect(); }
  }, delay);
}

// ── conexão Baileys ─────────────────────────────────────────────────
async function start() {
  _loggingOut = false;
  if (sock) { try { sock.ev.removeAllListeners(); } catch (e) { /* ignora */ } } // evita ouvintes órfãos
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    browser: ["AutoFlow", "Chrome", "1.0.0"],
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      status = "qr";
      try { qrDataUrl = await qrcode.toDataURL(qr); } catch { qrDataUrl = null; }
      logger.warn("QR disponível — escaneie no WhatsApp.");
    }
    if (connection === "open") {
      status = "connected";
      qrDataUrl = null;
      reconnectAttempts = 0; // conexão estável -> zera o backoff
      logger.warn("✅ WhatsApp conectado.");
      _lastHealthyAt = Date.now(); _healthFails = 0; _decryptFails = 0; _zombie = false;
    }
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      status = "disconnected";
      logger.warn(`conexão fechada (code=${code}) loggedOut=${loggedOut}`);
      if (loggedOut) qrDataUrl = null; // sessão encerrada -> próximo start gera novo QR
      if (!loggedOut && !_loggingOut) scheduleReconnect(); // nao reconecta em logout
    }
  });

  // contatos (eventos variam por versão — todos defensivos)
  sock.ev.on("contacts.upsert", (arr = []) => {
    for (const c of arr) rememberContact(c.id, c.name || c.notify || c.verifiedName);
  });
  sock.ev.on("contacts.set", ({ contacts: arr = [] } = {}) => {
    for (const c of arr) rememberContact(c.id, c.name || c.notify || c.verifiedName);
  });
  sock.ev.on("messaging-history.set", ({ contacts: arr = [] } = {}) => {
    for (const c of arr) rememberContact(c.id, c.name || c.notify || c.verifiedName);
  });

  const _seenMsgIds = new Map();
function _isDupMsg(id){
  if(!id) return false;
  var now = Date.now();
  for (var ent of _seenMsgIds) { if (now - ent[1] > 300000) _seenMsgIds.delete(ent[0]); }
  if (_seenMsgIds.has(id)) return true;
  _seenMsgIds.set(id, now);
  return false;
}
// mensagens recebidas -> webhook
  sock.ev.on("messages.upsert", async ({ messages = [], type }) => {
    if (type !== "notify") return;
    _lastInboundAt = Date.now(); _lastHealthyAt = Date.now(); _decryptFails = 0; _zombie = false;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        if (_isDupMsg(msg.key.id)) continue;
        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid === "status@broadcast" || remoteJid.endsWith("@g.us")) continue; // ignora status e grupos
        const text = extractText(msg);
        if (!text) continue;

        const pushName = msg.pushName || "";
        rememberContact(remoteJid, pushName);

        let realJid = msg.key.senderPn || msg.key.participantPn || "";
        if (!realJid && remoteJid.endsWith("@lid")) {
          try { const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(remoteJid); if (mapped) realJid = mapped; } catch (_) {}
        }
        if (!realJid && remoteJid.endsWith("@s.whatsapp.net")) realJid = remoteJid;
        const realDigits = onlyDigits(realJid);
        const lidDigits = isLid(remoteJid) ? phoneFromJid(remoteJid) : "";

        await postWebhook({
          from: remoteJid,
          text,
          pushName,
          fromReal: realDigits,
          fromLid: lidDigits,
          replyTo: remoteJid,
        });
      } catch (e) {
        logger.warn(`erro processando msg: ${e.message}`);
      }
    }
  });
}

// ── envio ───────────────────────────────────────────────────────────
async function targetJid({ to, replyTo }) {
  if (replyTo && String(replyTo).includes("@")) return replyTo;
  const digits = onlyDigits(to);
  if (!digits) throw new Error("invalid_destination");
  return await resolveJid(digits);
}

async function sendText({ to, text, replyTo }) {
  if (!sock || status !== "connected") throw new Error("not_connected");
  const jid = await targetJid({ to, replyTo });
  const r = await sock.sendMessage(jid, { text: String(text || "") });
  return { ok: true, id: r?.key?.id || null, jid };
}

async function sendMedia({ to, type, url, caption }) {
  if (!sock || status !== "connected") throw new Error("not_connected");
  const jid = await resolveJid(to);
  const localPath = resolveLocalPath(url);
  const src = (localPath && fs.existsSync(localPath)) ? fs.readFileSync(localPath) : { url };
  let content;
  if (type === "audio") {
    // Mensagem de voz (ptt): ogg/opus vai direto; outros formatos são convertidos.
    let buffer = null;
    if (localPath && fs.existsSync(localPath)) {
      buffer = /\.(ogg|oga|opus)$/i.test(localPath) ? fs.readFileSync(localPath) : await toOpus(localPath);
    }
    content = { audio: buffer || { url }, ptt: true, mimetype: "audio/ogg; codecs=opus" };
  } else if (type === "image") content = { image: src, caption: caption || "" };
  else if (type === "video") content = { video: src, caption: caption || "" };
  else if (type === "document") content = { document: src, fileName: caption || "arquivo" };
  else content = { text: caption || "" };
  const r = await sock.sendMessage(jid, content);
  return { ok: true, id: r?.key?.id || null, jid };
}

// ── HTTP ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, status }));
app.get("/status", (_req, res) => res.json({ status, hasQr: !!qrDataUrl, zombie: _zombie, lastInboundAgoSec: Math.round((Date.now()-_lastInboundAt)/1000), lastHealthyAgoSec: Math.round((Date.now()-_lastHealthyAt)/1000), healthy: !_zombie && status === "connected" }));
app.get("/qr", (_req, res) => res.json({ qr: qrDataUrl, status }));

app.get("/contacts", (req, res) => {
  res.json(listContacts(req.query.q, req.query.limit));
});

app.post("/send", async (req, res) => {
  try { res.json(await sendText(req.body || {})); }
  catch (e) { res.status(e.message === "not_connected" ? 409 : 500).json({ error: e.message }); }
});

app.post("/send-media", async (req, res) => {
  try { res.json(await sendMedia(req.body || {})); }
  catch (e) { res.status(e.message === "not_connected" ? 409 : 500).json({ error: e.message }); }
});

app.post("/logout", async (_req, res) => {
  try {
    _loggingOut = true;
    logger.warn("logout solicitado via API");
    res.json({ ok: true, message: "sessao encerrada, gerando novo QR" });
    try { if (sock && sock.logout) { sock.logout().catch(()=>{}); } } catch (e) { logger.warn("sock.logout falhou: " + e.message); }
    try { if (sock && sock.end) sock.end(new Error("logout")); } catch (e) {}
    try { for (const f of fs.readdirSync(AUTH_DIR)) fs.rmSync(AUTH_DIR + "/" + f, { recursive: true, force: true }); } catch (e) { logger.error("falha limpando auth: " + e.message); }
    sock = null; status = "disconnected"; qrDataUrl = null; _zombie = false;
    setTimeout(() => { start().catch((e) => { logger.error("falha ao reiniciar pos-logout: " + e.message); }); }, 800);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.listen(PORT, () => logger.warn(`✅ WA Gateway :${PORT}`));
start().catch((e) => { logger.error(`falha ao iniciar: ${e.message}`); status = "disconnected"; });
