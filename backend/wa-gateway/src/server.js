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

const PORT = process.env.PORT || 3333;
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://api:3000/api/internal/message";

const logger = pino({ level: process.env.LOG_LEVEL || "warn" });

// ── estado em memória ──────────────────────────────────────────────
let sock = null;
let status = "starting";          // starting | qr | connected | disconnected
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
function scheduleReconnect() {
  if (reconnectTimer) return; // já há um reconnect agendado
  const delay = Math.min(30000, 1500 * 2 ** reconnectAttempts);
  reconnectAttempts++;
  logger.warn(`reagendando conexão em ${delay}ms (tentativa ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    start().catch((e) => { logger.error(e.message); scheduleReconnect(); });
  }, delay);
}

// ── conexão Baileys ─────────────────────────────────────────────────
async function start() {
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
    }
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      status = "disconnected";
      logger.warn(`conexão fechada (code=${code}) loggedOut=${loggedOut}`);
      if (loggedOut) qrDataUrl = null; // sessão encerrada -> próximo start gera novo QR
      scheduleReconnect(); // single-flight + backoff (sem tempestade)
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

  // mensagens recebidas -> webhook
  sock.ev.on("messages.upsert", async ({ messages = [], type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid === "status@broadcast" || remoteJid.endsWith("@g.us")) continue; // ignora status e grupos
        const text = extractText(msg);
        if (!text) continue;

        const pushName = msg.pushName || "";
        rememberContact(remoteJid, pushName);

        const realDigits = remoteJid.endsWith("@s.whatsapp.net") ? phoneFromJid(remoteJid) : "";
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
  let content;
  if (type === "image") content = { image: { url }, caption: caption || "" };
  else if (type === "video") content = { video: { url }, caption: caption || "" };
  else if (type === "document") content = { document: { url }, fileName: caption || "arquivo" };
  else content = { text: caption || "" };
  const r = await sock.sendMessage(jid, content);
  return { ok: true, id: r?.key?.id || null, jid };
}

// ── HTTP ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, status }));
app.get("/status", (_req, res) => res.json({ status, hasQr: !!qrDataUrl }));
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

app.listen(PORT, () => logger.warn(`✅ WA Gateway :${PORT}`));
start().catch((e) => { logger.error(`falha ao iniciar: ${e.message}`); status = "disconnected"; });
