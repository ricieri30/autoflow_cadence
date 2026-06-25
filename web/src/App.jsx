import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle, LayoutDashboard, Users, Workflow, Repeat, MessageSquareReply,
  CalendarClock, FileText, ScrollText, CreditCard, Database, User as UserIcon,
  MessageSquare, LogOut, Loader2, RefreshCw, Clock, Copy, Pencil, Trash2,
  Download, Upload, Search, Check, Plus, X, CheckCircle2, Smartphone,
  ArrowUpRight, Menu } from "lucide-react";
import { api, getToken, setToken, clearToken } from "./api.js";

/* ════════════════════════════════════════════════════════════════════
   PRIMITIVOS COMPARTILHADOS  (espelham os helpers do bundle original)
   ════════════════════════════════════════════════════════════════════ */

// concat condicional de classes (helper `A` no bundle)
function cn(...xs) { return xs.filter(Boolean).join(" "); }

// Resolve o nome do cliente pela SUA agenda (Clientes). Tolera 9º dígito BR e últimos 8.
function agendaResolve(contacts, phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d || !Array.isArray(contacts)) return "";
  const variants = new Set([d]);
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") variants.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith("55")) variants.add(d.slice(0, 4) + "9" + d.slice(4));
  const tail = d.slice(-8);
  const c = contacts.find((x) => {
    const p = String(x.phoneE164 || x.phone || "").replace(/\D/g, "");
    return variants.has(p) || (p.length >= 8 && p.slice(-8) === tail);
  });
  return c && c.name ? c.name.trim() : "";
}
// Carrega a agenda (Clientes) uma vez para resolução de nomes nas telas
function useAgenda() {
  const [list, setList] = useState([]);
  useEffect(() => { api("contacts").then((x) => setList(Array.isArray(x) ? x : [])).catch(() => {}); }, []);
  return list;
}

// classes de input/select reutilizadas em todo o app (`V` / `Yt` no bundle)
const INPUT =
  "w-full bg-ink border border-hair-2 text-bone rounded-xl px-3 py-2 text-sm placeholder:text-mut focus:outline-none focus:border-signal/60 focus:ring-1 focus:ring-signal/30 transition";
const SELECT = INPUT;

// Baixa um objeto/array como arquivo .json
function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Barra reutilizável Exportar/Importar (backup por função) — estilo Cadence
function BackupBar({ label, onExport, onImport, toast }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  async function doExport() {
    setBusy(true);
    try { const data = await onExport(); downloadJSON(`${label}-${new Date().toISOString().slice(0, 10)}.json`, data); toast && toast("Exportado.", "emerald"); }
    catch (e) { toast && toast("Erro ao exportar: " + e.message, "red"); }
    finally { setBusy(false); }
  }
  async function onFile(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const n = await onImport(parsed);
      toast && toast(`Importado${typeof n === "number" ? `: ${n} item(ns)` : ""}.`, "emerald");
    } catch (e) { toast && toast("Erro ao importar: " + e.message, "red"); }
    finally { setBusy(false); }
  }
  const btn = "flex items-center gap-2 px-3 py-2 rounded-[10px] border border-hair-2 bg-raised hover:bg-raised-2 text-mist hover:text-bone text-sm font-medium transition-colors disabled:opacity-50";
  return (
    <div className="flex items-center gap-2">
      <button disabled={busy} onClick={doExport} className={btn} title="Baixar os dados desta função (.json)"><Download className="h-4 w-4" /> Exportar</button>
      <button disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} className={btn} title="Restaurar de um arquivo .json"><Upload className="h-4 w-4" /> Importar</button>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
    </div>
  );
}

// Upload de mídia (áudio/imagem/vídeo/documento) -> POST /api/upload-media -> referência local:
function MediaUpload({ type, onUploaded, toast }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const accept = type === "audio" ? "audio/*" : type === "image" ? "image/*" : type === "video" ? "video/*" : "*/*";
  async function onFile(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const token = getToken();
      const res = await fetch("/api/upload-media", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      if (!res.ok) throw new Error("HTTP_" + res.status);
      const data = await res.json();
      onUploaded(data.url || data.mediaId || "");
      toast && toast("Mídia enviada.", "emerald");
    } catch {
      toast && toast("Upload de mídia indisponível no backend atual (será ativado no deploy de backend).", "red");
    } finally { setBusy(false); }
  }
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => ref.current && ref.current.click()} className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-hair-2 bg-raised hover:bg-raised-2 text-mist hover:text-bone text-sm font-medium transition-colors disabled:opacity-50">
        <Upload className="h-4 w-4" /> {busy ? "Enviando..." : (type === "audio" ? "Enviar áudio (.mp3, .ogg, .m4a…)" : "Escolher arquivo")}
      </button>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={onFile} />
    </div>
  );
}

// Campo com rótulo (`$` no bundle)
function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-mut mb-1.5 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

// Modal (`Pt` no bundle)
function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-5xl bg-ink-2 border border-hair rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 flex items-center justify-between border-b border-hair sticky top-0 bg-ink-2 z-10">
          <div className="font-display font-semibold text-bone">{title}</div>
          <button onClick={onClose} className="text-mut hover:text-bone text-lg leading-none">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Toast simples
function PremiumBadge() {
  return (
    <span className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md bg-gradient-to-r from-gold-500/20 to-gold-300/10 text-gold-300 border border-gold-500/30">
      PREMIUM
    </span>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const tone = {
    indigo: "bg-signal text-ink",
    red: "bg-red-500 text-bone",
    slate: "bg-raised-2 text-bone border border-hair-2",
    emerald: "bg-signal text-ink",
  }[toast.tone] || "bg-raised-2 text-bone border border-hair-2";
  return (
    <div className={cn("fixed top-4 right-4 z-[100] px-4 py-3 rounded-xl text-sm font-medium shadow-xl flex items-center gap-2 transition-all", tone)}>
      {toast.msg}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, tone = "indigo") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return [toast, show];
}

// Indicador de status do WhatsApp (`xo` no bundle)
function StatusDot({ status }) {
  const wrap = {
    connected: "bg-signal/15 text-signal border border-signal/30",
    qr: "bg-amber-400/15 text-amber-300 border border-amber-400/30",
    disconnected: "bg-red-400/15 text-red-300 border border-red-400/30",
    starting: "bg-mut/20 text-mut border border-hair-2",
  }[status] || "bg-mut/20 text-mut border border-hair-2";
  const dot = {
    connected: "bg-signal cad-livedot", qr: "bg-amber-300 animate-pulse",
    disconnected: "bg-red-300", starting: "bg-mut animate-pulse",
  }[status] || "bg-mut";
  const label = status === "connected" ? "Conectado"
    : status === "qr" ? "Aguardando QR"
    : status === "starting" ? "Iniciando" : "Desconectado";
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", wrap)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

// Item de navegação da sidebar (`Xe` no bundle)
function NavItem({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-2.5 py-2 rounded-[10px] text-sm font-medium transition-colors border border-transparent",
        active
          ? "bg-gradient-to-r from-[rgba(63,224,162,0.13)] to-[rgba(63,224,162,0.03)] text-bone border-[rgba(63,224,162,0.25)]"
          : "text-mist hover:bg-raised hover:text-bone"
      )}
    >
      <Icon className={cn("h-4 w-4 flex-shrink-0", active && "text-signal")} />
      <span className="flex-1 text-left">{label}</span>
      {badge ? <span className="text-[10.5px] font-mono text-brand-400 bg-brand-900/50 px-1.5 py-0.5 rounded-full">{badge}</span> : null}
    </button>
  );
}

// Seletor de contato com busca + entrada manual (`hr` no bundle).
// MELHORIA DE UI: deixa explícito que dá pra digitar o número à mão,
// sem remover a busca por nome.
function ContactPicker({ value, onChange, onPickContact, placeholder = "Ex: 5511999999999", className, source = "whatsapp" }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function search(q) {
    setLoading(true);
    try {
      if (source === "agenda") {
        // Busca na SUA agenda (Clientes): seus nomes, números reais (sem LID)
        const all = await api("contacts");
        const ql = String(q || "").toLowerCase().trim();
        const qd = String(q || "").replace(/\D/g, "");
        const filtered = (Array.isArray(all) ? all : [])
          .filter((c) => {
            const nm = String(c.name || "").toLowerCase();
            const ph = String(c.phoneE164 || c.phone || "").replace(/\D/g, "");
            return !ql || nm.includes(ql) || (qd && ph.includes(qd));
          })
          .slice(0, 8)
          .map((c) => ({ phone: c.phoneE164 || c.phone || "", name: c.name || "" }));
        setResults(filtered);
      } else {
        const data = await api(`whatsapp/contacts?q=${encodeURIComponent(q)}&limit=8`);
        setResults(Array.isArray(data) ? data : []);
      }
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }
  function onInput(e) {
    const v = e.target.value;
    onChange(v);
    onPickContact && onPickContact({ phone: v, name: "" });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(v), 280);
  }
  function pick(c) {
    onChange(c.phone);
    onPickContact && onPickContact(c);
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          className={className || INPUT}
          value={value}
          onChange={onInput}
          onFocus={() => search(value)}
          placeholder={placeholder}
          autoComplete="off"
          inputMode="numeric"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-mist" />}
      </div>
      {/* dica de número manual — torna explícita a digitação direta */}
      <div className="text-xs text-mut mt-1">
        Digite o número com DDD (ex.: 5511999999999) <span className="text-mut">ou</span> busque {source === "agenda" ? "nos seus Clientes" : "pelo nome do contato"}.
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-raised border border-hair-2 rounded-xl shadow-xl overflow-hidden">
          {results.map((c, idx) => (
            <button
              key={(c.phone || "") + idx}
              type="button"
              onMouseDown={() => pick(c)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-raised transition-colors text-left"
            >
              <div className="w-8 h-8 bg-brand-600/20 border border-brand-500/30 rounded-full flex items-center justify-center flex-shrink-0">
                <UserIcon className="h-4 w-4 text-brand-300" />
              </div>
              <div className="min-w-0">
                <div className="text-sm text-bone truncate">
                  {c.name && c.name.trim() ? c.name : "(sem nome)"}
                  {c.uncertain ? <span className="ml-1.5 text-amber-300 text-xs">• incerto</span> : null}
                </div>
                <div className="text-xs text-mist font-mono">{c.phone}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   CRON BUILDER  (`km` no bundle)
   ════════════════════════════════════════════════════════════════════ */
function buildCron(cfg) {
  const [hh = "09", mm = "00"] = String(cfg.time || "09:00").split(":");
  const h = String(parseInt(hh, 10) || 0);
  const m = String(parseInt(mm, 10) || 0);
  if (cfg.repeatKind === "daily") return `${m} ${h} * * *`;
  if (cfg.repeatKind === "weekly") {
    const days = (cfg.weeklyDays && cfg.weeklyDays.length ? cfg.weeklyDays : [1]).slice().sort((a, b) => a - b);
    return `${m} ${h} * * ${days.join(",")}`;
  }
  if (cfg.repeatKind === "monthly") {
    const d = Math.min(31, Math.max(1, parseInt(cfg.monthlyDay, 10) || 1));
    return `${m} ${h} ${d} * *`;
  }
  const every = Math.max(1, parseInt(cfg.intervalEvery, 10) || 1);
  return cfg.intervalUnit === "hours" ? `${m} */${every} * * *` : `*/${every} * * * *`;
}

function cfgFromPattern(pattern) {
  const out = {};
  const p = String(pattern || "").trim();
  const f = p.split(/\s+/);
  if (f.length !== 5) return out;
  const [min, hr, dom, mon, dow] = f;
  const two = (n) => String(n).padStart(2, "0");
  if (min.startsWith("*/") && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    out.repeatKind = "interval"; out.intervalUnit = "minutes";
    out.intervalEvery = parseInt(min.slice(2), 10) || 1; return out;
  }
  if (hr.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    out.repeatKind = "interval"; out.intervalUnit = "hours";
    out.intervalEvery = parseInt(hr.slice(2), 10) || 1;
    out.time = two(parseInt(min, 10) || 0) + ":00"; return out;
  }
  const h = parseInt(hr, 10); const m = parseInt(min, 10);
  if (!isNaN(h) && !isNaN(m)) out.time = two(h) + ":" + two(m);
  if (dom === "*" && dow !== "*") {
    out.repeatKind = "weekly";
    out.weeklyDays = dow.split(",").map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
    if (!out.weeklyDays.length) out.weeklyDays = [1];
    return out;
  }
  if (dom !== "*" && dow === "*") {
    out.repeatKind = "monthly"; out.monthlyDay = parseInt(dom, 10) || 1; return out;
  }
  out.repeatKind = "daily"; return out;
}

const WEEKDAYS = [
  { v: 0, l: "Dom" }, { v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" },
  { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" },
];

/* ════════════════════════════════════════════════════════════════════
   TELA: VISÃO GERAL (dashboard)
   ════════════════════════════════════════════════════════════════════ */
function DashboardView({ onNavigate }) {
  const [data, setData] = useState(null);
  const [arCount, setArCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, ar] = await Promise.all([api("dashboard"), api("auto-reply").catch(() => [])]);
      setData(d);
      const list = Array.isArray(ar) ? ar : [];
      setArCount({ active: list.filter((r) => r.active).length, total: list.length });
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const readouts = data ? [
    { tone: "signal", label: "Automações ativas", value: <>{data.recurringActive}<small className="text-mut text-[18px]">/{data.recurringTotal}</small></>, meta: "disparos via cron", tab: "recurring" },
    { tone: "lime",   label: "Respostas Auto",    value: arCount ? <>{arCount.active}<small className="text-mut text-[18px]">/{arCount.total}</small></> : "—", meta: "palavras-chave ativas", tab: "autoReply" },
    { tone: "sky",    label: "Clientes",          value: data.contacts,      meta: "na base", tab: "contacts" },
    { tone: "brand",  label: "Templates",         value: data.templates,     meta: "reutilizáveis", tab: "tpl" },
    { tone: "amber",  label: "Na esteira",        value: data.pipelineActive, meta: "em andamento", tab: "pipeline" },
  ] : [];
  const toneMap = {
    signal: "bg-signal", lime: "bg-lime-400", sky: "bg-sky-400", brand: "bg-brand-400", amber: "bg-amber-400",
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 pt-5">
        <div>
          <div className="text-[10.5px] tracking-[0.18em] uppercase text-mut mb-1">Console</div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Visão Geral</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-signal/30 bg-[rgba(63,224,162,0.07)] text-[11px] tracking-[0.13em] uppercase font-semibold text-signal">
            <span className="w-1.5 h-1.5 rounded-full bg-signal cad-livedot" /> Sinal vivo
          </span>
          <button onClick={load} className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] border border-hair-2 bg-raised hover:bg-raised-2 text-mist hover:text-bone text-sm font-medium transition-colors">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
          </button>
        </div>
      </div>

      <div className="cad-sweep mx-6 mt-4" />

      <div className="p-6 space-y-[18px]">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {readouts.map((c, i) => (
          <button key={i} onClick={() => onNavigate(c.tab)} className="group relative overflow-hidden rounded-2xl border border-hair p-4 bg-gradient-to-b from-raised to-ink-2 transition-all hover:-translate-y-0.5 hover:border-hair-2 text-left">
            <div className={cn("absolute -right-5 -top-5 w-20 h-20 rounded-full blur-lg opacity-10", toneMap[c.tone])} />
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-semibold text-mut">
              <span className={cn("w-2.5 h-2.5 rounded-[3px]", toneMap[c.tone])} />{c.label}
            </div>
            <div className="font-mono font-medium text-[34px] leading-none tracking-tight mt-2.5 text-bone">{c.value}</div>
            <div className="flex items-center justify-between mt-1.5">
              <div className="text-[11px] text-mist">{c.meta}</div>
              <ArrowUpRight className="h-3.5 w-3.5 text-mut opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="rounded-2xl border border-hair bg-ink-2 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-hair">
            <span className="font-display font-semibold text-sm text-bone">Próximas automações</span>
            <span className="font-mono text-[10px] text-mut">cron · America/Sao_Paulo</span>
          </div>
          <div className="p-1.5">
            {(data?.upcoming || []).length === 0 && <div className="text-sm text-mut px-3 py-2">Nenhuma automação agendada.</div>}
            {(data?.upcoming || []).map((c, i) => (
              <button key={i} onClick={() => onNavigate("recurring")} className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-raised transition-colors">
                <span className="w-[3px] self-stretch rounded bg-brand-400/60 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-bone truncate">{c.name}</div>
                  <div className="text-[11.5px] text-mut truncate">{c.templateName}</div>
                </div>
                <div className="ml-auto text-right flex-shrink-0">
                  <div className="font-mono text-xs text-signal">{new Date(c.next).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
                  <div className="font-mono text-[11px] text-mut">{new Date(c.next).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-hair bg-ink-2 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-hair">
            <span className="font-display font-semibold text-sm text-bone">Atividade recente</span>
            <span className="font-mono text-[10px] text-mut">registro</span>
          </div>
          <div className="p-1.5">
            {(data?.recentAudit || []).length === 0 && <div className="text-sm text-mut px-3 py-2">Sem atividade.</div>}
            {(data?.recentAudit || []).map((c, i) => (
              <button key={i} onClick={() => onNavigate("audit")} className="w-full text-left flex items-baseline gap-2.5 px-3 py-2 rounded-lg hover:bg-raised transition-colors">
                <span className="text-[12.5px] text-mist min-w-0 truncate">{c.detail || c.action}</span>
                <span className="ml-auto font-mono text-[10.5px] text-mut flex-shrink-0">{new Date(c.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <ConnectBanner onNavigate={onNavigate} />
      </div>
    </div>
  );
}

// Banner de conexão do WhatsApp (`Tm` no bundle)
function ConnectBanner({ onNavigate }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    api("whatsapp/status").then((s) => { if (alive) setSt(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!st || st.status === "connected") return null;
  return (
    <div className="bg-amber-400/10 border border-amber-400/25 rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="text-sm text-amber-200">WhatsApp não está conectado. Conecte para enviar e receber mensagens.</div>
      <button onClick={() => onNavigate("whatsapp")} className="flex-shrink-0 text-xs font-semibold px-3.5 py-2 rounded-lg bg-signal hover:opacity-90 text-ink transition-opacity">Conectar</button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: CLIENTES (contacts)
   ════════════════════════════════════════════════════════════════════ */
function subBadge(c) {
  const end = c.subscriptionEnd ? new Date(c.subscriptionEnd) : null;
  if (!end) return { label: "Sem plano", cls: "border-hair-2 text-mut" };
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((end - now) / 86400000);
  if (days < 0) return { label: "Vencido", cls: "border-red-400/50 text-red-300 bg-red-400/10" };
  if (days === 0) return { label: "Vence hoje", cls: "border-amber-400/50 text-amber-300 bg-amber-400/10" };
  if (days <= 7) return { label: "Vencendo 7d", cls: "border-amber-400/50 text-amber-300 bg-amber-400/10" };
  return { label: "Ativo", cls: "border-signal/50 text-signal bg-signal/10" };
}

function ContactsView({ toast }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const blank = { phone: "", name: "", tags: "", subscriptionStart: "", subscriptionEnd: "", subscriptionNotes: "" };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => { try { setList(await api("contacts")); } catch { /* */ } }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm(blank); setOpen(true); }
  function openEdit(c) {
    setEditing(c);
    setForm({
      phone: c.phoneE164 || "", name: c.name || "",
      tags: (c.tags || []).join(", "),
      subscriptionStart: c.subscriptionStart ? c.subscriptionStart.slice(0, 10) : "",
      subscriptionEnd: c.subscriptionEnd ? c.subscriptionEnd.slice(0, 10) : "",
      subscriptionNotes: c.subscriptionNotes || "",
    });
    setOpen(true);
  }
  async function save() {
    const payload = {
      phoneE164: form.phone, name: form.name,
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      subscriptionStart: form.subscriptionStart || null,
      subscriptionEnd: form.subscriptionEnd || null,
      subscriptionNotes: form.subscriptionNotes,
    };
    try {
      if (editing) { const { phoneE164, ...rest } = payload; await api(`contacts/${editing._id}`, { method: "PUT", body: { ...rest, optIn: true } }); toast("Cliente atualizado.", "indigo"); }
      else { await api("contacts", { method: "POST", body: payload }); toast("Cliente cadastrado.", "indigo"); }
      setOpen(false); await load();
    } catch (e) { toast("Erro ao salvar: " + e.message, "red"); }
  }
  async function del(c) {
    if (!confirm(`Remover ${c.name || c.phoneE164}?`)) return;
    try { await api(`contacts/${c._id}`, { method: "DELETE" }); toast("Cliente removido.", "slate"); await load(); }
    catch (e) { toast("Erro: " + e.message, "red"); }
  }

  const filtered = list.filter((c) => {
    const s = q.toLowerCase();
    return !s || (c.name || "").toLowerCase().includes(s) || (c.phoneE164 || "").includes(s);
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Clientes</h1>
          <p className="text-sm text-mut mt-0.5">{list.length} cadastrado(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <BackupBar label="clientes" toast={toast}
            onExport={() => api("contacts")}
            onImport={async (arr) => { const items = Array.isArray(arr) ? arr : (arr.contacts || []); let n = 0; for (const c of items) { try { await api("contacts", { method: "POST", body: { phoneE164: c.phoneE164 || c.phone, name: c.name || "", tags: c.tags || [], subscriptionStart: c.subscriptionStart || null, subscriptionEnd: c.subscriptionEnd || null, subscriptionNotes: c.subscriptionNotes || "", optIn: true } }); n++; } catch { /* pula duplicado */ } } await load(); return n; }} />
          <button onClick={openNew} className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-signal hover:opacity-90 text-ink text-sm font-semibold transition-opacity">
            <Plus className="h-4 w-4" /> Adicionar Cliente
          </button>
        </div>
      </div>
      <div className="cad-sweep" />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-mut" />
        <input className={cn(INPUT, "pl-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou número..." />
      </div>

      <div className="bg-ink-2 border border-hair rounded-2xl overflow-hidden">
        <div className="grid grid-cols-12 bg-raised text-[11px] font-semibold text-mut border-b border-hair px-4 py-3 uppercase tracking-wide">
          <div className="col-span-4">Cliente</div>
          <div className="col-span-3">WhatsApp</div>
          <div className="col-span-3">Vencimento</div>
          <div className="col-span-2">Ações</div>
        </div>
        {filtered.length === 0 && <div className="px-4 py-10 text-center text-mut text-sm">{q ? "Nenhum resultado" : "Nenhum cliente cadastrado"}</div>}
        {filtered.map((c) => {
          const b = subBadge(c);
          return (
            <div key={c._id} className="grid grid-cols-12 border-b border-hair px-4 py-3 text-sm hover:bg-raised transition-colors items-center">
              <div className="col-span-4">
                <div className={cn("font-medium", c.name ? "text-bone" : "text-mut italic")}>{c.name || "Sem nome"}</div>
                {(c.tags || []).length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {c.tags.map((t, i) => <span key={i} className="px-1.5 py-0.5 bg-raised-2 text-mist rounded text-xs">{t}</span>)}
                  </div>
                )}
              </div>
              <div className="col-span-3 text-mist font-mono text-xs">{c.phoneE164}</div>
              <div className="col-span-3 text-xs">
                <span className={cn("px-2 py-1 rounded-full border", b.cls)}>{b.label}</span>
                {c.subscriptionEnd && <div className="text-mut mt-1 font-mono">{new Date(c.subscriptionEnd).toLocaleDateString("pt-BR")}</div>}
              </div>
              <div className="col-span-2 flex gap-1">
                <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg border border-hair-2 hover:bg-brand-500/10 text-mut hover:text-brand-300 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => del(c)} className="p-1.5 rounded-lg border border-hair-2 hover:bg-red-500/10 text-mut hover:text-red-300 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={open} title={editing ? "Editar Cliente" : "Adicionar Novo Cliente"} onClose={() => setOpen(false)}>
        <div className="space-y-4 max-w-md">
          <Field label="Número de WhatsApp *">
            {editing
              ? <input className={cn(INPUT, "opacity-60")} value={form.phone} disabled />
              : <ContactPicker value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} onPickContact={(c) => setForm((f) => ({ ...f, phone: c.phone || "", name: c.name || f.name }))} />}
          </Field>
          <Field label="Nome (opcional)"><input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: João Silva" /></Field>
          <Field label="Tags (separadas por vírgula)"><input className={INPUT} value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="vip, mensal" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Início da assinatura"><input type="date" className={INPUT} value={form.subscriptionStart} onChange={(e) => setForm((f) => ({ ...f, subscriptionStart: e.target.value }))} /></Field>
            <Field label="Vencimento"><input type="date" className={INPUT} value={form.subscriptionEnd} onChange={(e) => setForm((f) => ({ ...f, subscriptionEnd: e.target.value }))} /></Field>
          </div>
          <Field label="Observações"><textarea className={cn(INPUT, "min-h-[70px] resize-y")} value={form.subscriptionNotes} onChange={(e) => setForm((f) => ({ ...f, subscriptionNotes: e.target.value }))} /></Field>
          <div className="flex gap-3 pt-1">
            <button onClick={save} className="flex-1 rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 font-medium text-sm transition-colors">Salvar Cliente</button>
            <button onClick={() => setOpen(false)} className="px-4 rounded-xl border border-hair text-mist hover:bg-raised text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: TEMPLATES (tpl)
   ════════════════════════════════════════════════════════════════════ */
function extractVars(body) {
  const out = new Set();
  String(body || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => { out.add(k); return _m; });
  return Array.from(out);
}

function TemplatesView({ toast }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", body: "" });
  const load = useCallback(async () => { try { setList(await api("templates")); } catch { /* */ } }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm({ name: "", body: "" }); setOpen(true); }
  function openEdit(t) { setEditing(t); setForm({ name: t.name, body: t.body }); setOpen(true); }
  async function save() {
    const vars = extractVars(form.body);
    try {
      if (editing) { await api(`templates/${editing._id}`, { method: "PUT", body: { name: form.name, body: form.body, vars } }); toast("Template atualizado!", "indigo"); }
      else { await api("templates", { method: "POST", body: { name: form.name, body: form.body, vars } }); toast("Template criado!", "indigo"); }
      setOpen(false); await load();
    } catch (e) { toast("Erro ao salvar: " + e.message, "red"); }
  }
  async function clone(t) { try { await api(`templates/${t._id}/clone`, { method: "POST" }); toast("Template clonado!", "indigo"); await load(); } catch { toast("Erro ao clonar", "red"); } }
  async function del(t) {
    if (!confirm(`Deletar template "${t.name}"? Esta ação não pode ser desfeita.`)) return;
    try { await api(`templates/${t._id}`, { method: "DELETE" }); toast("Template deletado.", "slate"); await load(); } catch { toast("Erro ao deletar", "red"); }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Templates</h1>
          <p className="text-sm text-mut mt-1">Mensagens reutilizáveis com variáveis {"{{nome}}"}</p>
        </div>
        <div className="flex items-center gap-2">
          <BackupBar label="templates" toast={toast}
            onExport={() => api("templates")}
            onImport={async (arr) => { const items = Array.isArray(arr) ? arr : (arr.templates || []); let n = 0; for (const it of items) { try { const { _id, createdAt, updatedAt, __v, ...rest } = it; await api("templates", { method: "POST", body: rest }); n++; } catch {} } await load(); return n; }} />
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-signal hover:opacity-90 text-ink text-sm transition-colors"><Plus className="h-4 w-4" /> Criar template</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.length === 0 && <div className="text-mut text-sm">Nenhum template criado ainda.</div>}
        {list.map((t) => (
          <div key={t._id} className="bg-gradient-to-b from-raised to-ink-2 border border-hair rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-bone">{t.name}</div>
              <div className="text-xs text-mut">{new Date(t.createdAt).toLocaleDateString("pt-BR")}</div>
            </div>
            <div className="bg-ink border border-hair rounded-xl p-3 text-sm text-mist leading-relaxed min-h-[56px] whitespace-pre-wrap">{t.body}</div>
            {(t.vars || []).length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {t.vars.map((v, i) => <span key={i} className="text-xs px-2 py-0.5 bg-brand-500/10 text-brand-300 rounded-full font-mono">{`{{${v}}}`}</span>)}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-hair">
              <button onClick={() => clone(t)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-raised-2/50 hover:bg-raised text-mist text-xs font-medium transition-colors"><Copy className="h-3.5 w-3.5" /> Copiar</button>
              <button onClick={() => openEdit(t)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-raised-2/50 hover:bg-brand-600/30 hover:text-brand-300 text-mist text-xs font-medium transition-colors"><Pencil className="h-3.5 w-3.5" /> Editar</button>
              <button onClick={() => del(t)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-raised-2/50 hover:bg-red-400/15 hover:text-red-300 text-mist text-xs font-medium transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} title={editing ? "Editar template" : "Criar template"} onClose={() => setOpen(false)}>
        <div className="space-y-4 max-w-lg">
          <Field label="Nome *"><input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Confirmação" /></Field>
          <Field label="Mensagem *"><textarea className={cn(INPUT, "min-h-[120px] resize-y")} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Olá {{nome}}! ..." /></Field>
          <div className="text-xs text-mut">Variáveis detectadas: {extractVars(form.body).map((v) => `{{${v}}}`).join(", ") || "nenhuma"}</div>
          <div className="flex gap-3 pt-1">
            <button onClick={save} className="flex-1 rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 font-medium text-sm transition-colors">{editing ? "Salvar alterações" : "Criar template"}</button>
            <button onClick={() => setOpen(false)} className="px-4 rounded-xl border border-hair text-mist hover:bg-raised text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: RESPOSTAS AUTOMÁTICAS (autoReply)
   ════════════════════════════════════════════════════════════════════ */
function AutoReplyView({ toast }) {
  const [list, setList] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [mode, setMode] = useState("all"); // all | specific  (botões Todos / Puxar)
  const blank = { keyword: "", reply: "", targetPhone: "", targetName: "", startTime: "00:00", endTime: "23:59", active: true };
  const [form, setForm] = useState(blank);

  // painel de teste
  const [test, setTest] = useState({ phone: "", text: "" });
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ar, cs] = await Promise.all([api("auto-reply"), api("contacts").catch(() => [])]);
      setList(Array.isArray(ar) ? ar : []);
      setContacts(Array.isArray(cs) ? cs : []);
    } catch { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Nome do cliente pela SUA AGENDA (Clientes) — fonte da verdade, estavel.
  const agendaName = (phone) => agendaResolve(contacts, phone);

  function openNew() { setEditing(null); setForm(blank); setMode("all"); setOpen(true); }
  function openEdit(r) {
    setEditing(r);
    setForm({ keyword: r.keyword, reply: r.reply, targetPhone: r.targetPhone || "", targetName: r.targetName || "", startTime: r.startTime || "00:00", endTime: r.endTime || "23:59", active: r.active });
    setMode(r.targetPhone ? "specific" : "all");
    setOpen(true);
  }
  async function save() {
    if (!form.keyword || !form.reply) { toast("Palavra-chave e resposta são obrigatórias.", "red"); return; }
    const body = { ...form, targetPhone: mode === "specific" ? form.targetPhone : "" };
    try {
      if (editing) { await api(`auto-reply/${editing._id}`, { method: "PUT", body }); toast("Regra atualizada.", "indigo"); }
      else { await api("auto-reply", { method: "POST", body }); toast("Regra criada.", "indigo"); }
      setOpen(false); await load();
    } catch (e) { toast("Erro: " + e.message, "red"); }
  }
  async function toggle(id) { const r = list.find((x) => x._id === id); try { await api(`auto-reply/${id}`, { method: "PUT", body: { ...r, active: !r.active } }); await load(); } catch (e) { toast("Erro: " + e.message, "red"); } }
  async function clone(id) { try { await api(`auto-reply/${id}/clone`, { method: "POST" }); toast("Regra clonada (inicia inativa).", "indigo"); await load(); } catch { toast("Erro ao clonar", "red"); } }
  async function del(id) { if (!confirm("Deletar esta regra?")) return; try { await api(`auto-reply/${id}`, { method: "DELETE" }); toast("Regra deletada.", "slate"); await load(); } catch { toast("Erro", "red"); } }

  async function runTest() {
    setTesting(true); setTestResult(null);
    try { setTestResult(await api("auto-reply/test", { method: "POST", body: test })); }
    catch (e) { toast("Erro no teste: " + e.message, "red"); }
    finally { setTesting(false); }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Respostas Automáticas</h1>
          <p className="text-sm text-mut mt-1">Responde automaticamente quando a mensagem contém a palavra-chave.</p>
        </div>
        <div className="flex items-center gap-2">
          <BackupBar label="respostas-auto" toast={toast}
            onExport={() => api("auto-reply")}
            onImport={async (arr) => { const items = Array.isArray(arr) ? arr : (arr.rules || []); let n = 0; for (const it of items) { try { const { _id, createdAt, updatedAt, __v, ...rest } = it; await api("auto-reply", { method: "POST", body: rest }); n++; } catch {} } await load(); return n; }} />
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-signal hover:opacity-90 text-ink text-sm transition-colors"><Plus className="h-4 w-4" /> Nova regra</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.length === 0 && <div className="text-mut text-sm">Nenhuma regra criada ainda</div>}
        {list.map((y) => (
          <div key={y._id} className={cn("bg-raised/60 border rounded-2xl p-5 flex flex-col gap-4 transition-all", y.active ? "border-hair" : "border-hair opacity-70")}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-brand-400 text-lg">⚡</span>
                <span className="font-mono font-semibold text-bone text-base">"{y.keyword}"</span>
              </div>
              <button onClick={() => toggle(y._id)} title={y.active ? "Desativar" : "Ativar"} className={cn("relative w-12 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5", y.active ? "bg-brand-600" : "bg-hair-2")}>
                <span className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm", y.active ? "left-7" : "left-1")} />
              </button>
            </div>
            <div className="bg-ink border border-hair rounded-xl p-3 text-sm text-mist leading-relaxed min-h-[56px]">{y.reply}</div>
            <div className="flex items-center gap-4 text-xs text-mut flex-wrap">
              <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{y.targetPhone ? (agendaName(y.targetPhone) || y.targetName || y.targetPhone) : "Todos os clientes"}</span>
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{y.startTime || "00:00"} - {y.endTime || "23:59"}</span>
              <span className={cn("flex items-center gap-1 font-medium", y.active ? "text-signal" : "text-mut")}>
                <span className={cn("w-1.5 h-1.5 rounded-full", y.active ? "bg-emerald-400" : "bg-hair-2")} />{y.active ? "Ativo" : "Inativo"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-hair">
              <button onClick={() => clone(y._id)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-raised-2/50 hover:bg-raised text-mist text-xs font-medium transition-colors"><Copy className="h-3.5 w-3.5" /> Copiar</button>
              <button onClick={() => openEdit(y)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-raised-2/50 hover:bg-brand-600/30 hover:text-brand-300 text-mist text-xs font-medium transition-colors"><Pencil className="h-3.5 w-3.5" /> Editar</button>
              <button onClick={() => del(y._id)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-raised-2/50 hover:bg-red-400/15 hover:text-red-300 text-mist text-xs font-medium transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Painel de teste */}
      <div className="bg-ink-2 border border-hair rounded-2xl p-5 space-y-3">
        <div className="text-sm font-semibold text-bone">🧪 Testar Auto-Reply</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ContactPicker value={test.phone} onChange={(v) => setTest((t) => ({ ...t, phone: v }))} placeholder="Número do remetente" source="agenda" />
          <input className={INPUT} value={test.text} onChange={(e) => setTest((t) => ({ ...t, text: e.target.value }))} placeholder="Texto da mensagem recebida" />
          <button onClick={runTest} disabled={testing} className="rounded-xl bg-signal hover:opacity-90 disabled:opacity-50 text-ink py-2 font-medium text-sm flex items-center justify-center gap-2 transition-colors">
            {testing && <Loader2 className="h-4 w-4 animate-spin" />} Simular mensagem
          </button>
        </div>
        {testResult && (
          <div className="space-y-3">
            {testResult.matched ? (
              <div className="bg-signal/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                <div className="text-signal font-medium text-sm">✅ Regra encontrada!</div>
                <div className="text-xs text-mist mt-1">Keyword: <span className="bg-raised-2 px-1 rounded">{testResult.matched.keyword}</span></div>
                <div className="text-xs text-mist mt-1">Resposta: {testResult.matched.reply}</div>
              </div>
            ) : (
              <div className="bg-amber-400/10 border border-amber-500/20 rounded-xl px-4 py-3">
                <div className="text-amber-300 font-medium text-sm">⚠️ Nenhuma regra ativada</div>
                <div className="text-xs text-mist mt-1">Total de regras verificadas: {testResult.total_rules}</div>
              </div>
            )}
            <div>
              <div className="text-xs font-medium text-mist mb-2">Detalhes por regra:</div>
              <div className="space-y-1">
                {testResult.checked.map((c, i) => (
                  <div key={i} className={cn("flex items-center justify-between px-3 py-2 rounded-lg text-xs", c.skip_reason ? "bg-raised text-mut" : "bg-signal/10 text-signal")}>
                    <span className="font-mono">"{c.keyword}" → {c.targetPhone}</span>
                    <span>{
                      c.skip_reason === "numero_diferente" ? "⛔ Número diferente" :
                      c.skip_reason === "fora_horario" ? "⏰ Fora do horário" :
                      c.skip_reason === "keyword_nao_encontrada" ? "🔍 Keyword não encontrada" : "✅ Ativada"
                    }</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal criar/editar */}
      <Modal open={open} title={editing ? "Editar Resposta Automática" : "Criar Resposta Automática"} onClose={() => setOpen(false)}>
        <div className="space-y-4 max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Palavra-chave ou Mensagem Exata *">
              <input className={INPUT} value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))} placeholder="Ex: como pode me ajudar" />
            </Field>
            <Field label="Cliente Específico">
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => { setMode("all"); setForm((f) => ({ ...f, targetPhone: "", targetName: "" })); }} className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors", mode === "all" ? "bg-brand-600 border-brand-500 text-bone" : "border-hair-2 text-mist hover:bg-raised")}>Todos os clientes</button>
                <button type="button" onClick={() => setMode("specific")} className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center justify-center gap-1", mode === "specific" ? "bg-emerald-600 border-emerald-500 text-bone" : "border-hair-2 text-mist hover:bg-raised")}><Search className="h-3 w-3" /> Puxar</button>
              </div>
              {mode === "specific"
                ? <ContactPicker value={form.targetPhone} onChange={(v) => setForm((f) => ({ ...f, targetPhone: v }))} onPickContact={(c) => setForm((f) => ({ ...f, targetPhone: c.phone || "", targetName: c.name || "" }))} placeholder="Buscar nos seus Clientes..." source="agenda" />
                : <div className="bg-raised border border-hair rounded-xl px-3 py-2 text-sm text-mut italic">Responde a todos os contatos</div>}
            </Field>
          </div>
          <Field label="Mensagem de Resposta *">
            <textarea className={cn(INPUT, "min-h-[100px] resize-y")} value={form.reply} onChange={(e) => setForm((f) => ({ ...f, reply: e.target.value }))} placeholder="Ex: Olá! Posso ajudar com..." />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Horário Início"><input type="time" className={INPUT} value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} /></Field>
            <Field label="Horário Fim"><input type="time" className={INPUT} value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} /></Field>
          </div>
          <div className="flex items-center justify-between bg-raised border border-hair rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-medium text-bone">Ativar Regra</div>
              <div className="text-xs text-mut">Deixa a resposta automática funcionando.</div>
            </div>
            <button onClick={() => setForm((f) => ({ ...f, active: !f.active }))} className={cn("relative w-12 h-6 rounded-full transition-colors", form.active ? "bg-brand-600" : "bg-hair-2")}>
              <span className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow", form.active ? "left-7" : "left-1")} />
            </button>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={save} className="flex-1 rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 font-medium text-sm transition-colors">{editing ? "Salvar alterações" : "Salvar Regra"}</button>
            <button onClick={() => setOpen(false)} className="px-4 rounded-xl border border-hair text-mist hover:bg-raised text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: AUTOMAÇÕES (recurring)
   ════════════════════════════════════════════════════════════════════ */
function RecurringView({ toast }) {
  const [list, setList] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState([]);
  const blank = {
    name: "", templateId: "", targetType: "tag", targetValue: "",
    repeatKind: "daily", time: "09:00", weeklyDays: [1], monthlyDay: 1,
    intervalEvery: 1, intervalUnit: "hours", enabled: true,
    quietStart: "21:00", quietEnd: "08:00", throttlePerMinute: 10,
  };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    try { const [r, t] = await Promise.all([api("recurring"), api("templates")]); setList(r); setTemplates(t); } catch { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cron = buildCron(form);
  useEffect(() => {
    let alive = true;
    api("recurring/preview", { method: "POST", body: { pattern: cron, tz: "America/Sao_Paulo", count: 5 } })
      .then((d) => { if (alive) setPreview(d.runs || []); }).catch(() => { if (alive) setPreview([]); });
    return () => { alive = false; };
  }, [cron]);

  function openNew() { setEditing(null); setForm(blank); setOpen(true); }
  function openEdit(r) {
    setEditing(r);
    setForm({ ...blank, name: r.name, templateId: r.templateId?._id || r.templateId || "", targetType: r.targetType, targetValue: r.targetValue || "", time: "09:00", enabled: r.enabled, quietStart: r.quietHours?.start || "21:00", quietEnd: r.quietHours?.end || "08:00", throttlePerMinute: r.throttlePerMinute || 10 , ...cfgFromPattern(r.pattern) });
    setOpen(true);
  }
  async function save() {
    const body = {
      name: form.name || "Minha automação", templateId: form.templateId,
      targetType: form.targetType, targetValue: form.targetValue,
      pattern: cron, tz: "America/Sao_Paulo", enabled: form.enabled,
      throttlePerMinute: Number(form.throttlePerMinute) || 10,
      quietHours: { start: form.quietStart, end: form.quietEnd },
    };
    try {
      if (editing) { await api(`recurring/${editing._id}`, { method: "PUT", body }); toast("Automação atualizada.", "indigo"); }
      else { await api("recurring", { method: "POST", body }); toast("Automação criada.", "indigo"); }
      setOpen(false); await load();
    } catch (e) { toast("Erro: " + e.message, "red"); }
  }
  async function pause(id) { try { await api(`recurring/${id}/pause`, { method: "POST" }); await load(); } catch { /* */ } }
  async function resume(id) { try { await api(`recurring/${id}/resume`, { method: "POST" }); await load(); } catch { /* */ } }
  async function clone(id) { try { await api(`recurring/${id}/clone`, { method: "POST" }); toast("Automação clonada! Ela começa pausada para revisão.", "indigo"); await load(); } catch { toast("Erro ao clonar", "red"); } }
  async function del(id) { if (!confirm("Deletar esta automação? Esta ação não pode ser desfeita.")) return; try { await api(`recurring/${id}`, { method: "DELETE" }); toast("Automação deletada.", "slate"); await load(); } catch { toast("Erro", "red"); } }

  function toggleDay(d) { setForm((f) => ({ ...f, weeklyDays: f.weeklyDays.includes(d) ? f.weeklyDays.filter((x) => x !== d) : [...f.weeklyDays, d] })); }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Automações</h1>
          <p className="text-sm text-mut mt-0.5">Disparos recorrentes via expressão Cron.</p>
        </div>
        <div className="flex items-center gap-2">
          <BackupBar label="automacoes" toast={toast}
            onExport={() => api("recurring")}
            onImport={async (arr) => { const items = Array.isArray(arr) ? arr : (arr.recurring || []); let n = 0; for (const r of items) { try { await api("recurring", { method: "POST", body: { name: r.name || "Importada", templateId: (r.templateId && r.templateId._id) || r.templateId || "", targetType: r.targetType || "tag", targetValue: r.targetValue || "", pattern: r.pattern, tz: r.tz || "America/Sao_Paulo", enabled: false, throttlePerMinute: r.throttlePerMinute || 10, quietHours: r.quietHours || { start: "21:00", end: "08:00" } } }); n++; } catch { /* pula */ } } await load(); return n; }} />
          <button onClick={openNew} className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-signal hover:opacity-90 text-ink text-sm font-semibold transition-opacity"><Plus className="h-4 w-4" /> Nova automação</button>
        </div>
      </div>
      <div className="cad-sweep" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.length === 0 && <div className="text-mut text-sm">Nenhuma automação criada.</div>}
        {list.map((r) => (
          <div key={r._id} className={cn("rounded-2xl border p-5 flex flex-col gap-3 transition-colors bg-gradient-to-b from-raised to-ink-2", r.enabled ? "border-hair hover:border-hair-2" : "border-hair opacity-60")}>
            <div className="flex items-center justify-between">
              <div className="font-display font-semibold text-bone">{r.name || "(Sem nome)"}</div>
              <span className={cn("text-[11px] px-2.5 py-1 rounded-full border", r.enabled ? "bg-signal/15 text-signal border-signal/30" : "bg-raised-2 text-mut border-hair-2")}>{r.enabled ? "Ativa" : "Pausada"}</span>
            </div>
            <div className="text-xs text-mut space-y-1.5">
              <div>Template: <span className="text-mist">{r.templateId?.name || "—"}</span></div>
              <div>Alvo: <span className="text-mist">{r.targetType}</span> {r.targetValue ? `→ ${r.targetValue}` : ""}</div>
              <div className="flex items-center gap-1.5">Cron: <span className="font-mono text-signal bg-ink px-1.5 py-0.5 rounded border border-hair">{r.pattern}</span></div>
            </div>
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-hair">
              {r.enabled
                ? <button onClick={() => pause(r._id)} className="text-xs px-2 py-1.5 rounded-lg border border-hair-2 hover:bg-raised text-mist transition-colors">Pausar</button>
                : <button onClick={() => resume(r._id)} className="text-xs px-2 py-1.5 rounded-lg border border-signal/40 text-signal hover:bg-signal/10 transition-colors">Retomar</button>}
              <button onClick={() => openEdit(r)} className="text-xs px-2 py-1.5 rounded-lg border border-hair-2 hover:bg-raised text-mist transition-colors">Editar</button>
              <button onClick={() => clone(r._id)} className="text-xs px-2 py-1.5 rounded-lg border border-hair-2 hover:bg-raised text-mist transition-colors">Copiar</button>
              <button onClick={() => del(r._id)} className="text-xs px-2 py-1.5 rounded-lg border border-hair-2 hover:bg-red-500/10 text-red-300 transition-colors">Excluir</button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} title={editing ? "Editar automação" : "Nova automação recorrente"} onClose={() => setOpen(false)}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-raised border border-hair rounded-2xl p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Nome"><input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Minha automação" /></Field>
                <Field label="Template">
                  <select className={SELECT} value={form.templateId} onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}>
                    <option value="">Selecione...</option>
                    {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="Tipo de alvo">
                  <select className={SELECT} value={form.targetType} onChange={(e) => setForm((f) => ({ ...f, targetType: e.target.value, targetValue: "" }))}>
                    <option value="tag">Tag</option>
                    <option value="phone">Número</option>
                    <option value="contact">Contato</option>
                  </select>
                </Field>
                <Field label="Valor do alvo">
                  {form.targetType === "contact"
                    ? <ContactPicker value={form.targetValue} onChange={(v) => setForm((f) => ({ ...f, targetValue: v }))} placeholder="Buscar nos seus Clientes..." source="agenda" />
                    : <input className={INPUT} value={form.targetValue} onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value }))} placeholder={form.targetType === "tag" ? "Ex: vip" : "Ex: 5511999999999"} />}
                </Field>
              </div>
            </div>

            <div className="bg-raised border border-hair rounded-2xl p-4 space-y-3">
              <div className="text-sm font-semibold text-bone">Frequência</div>
              <div className="flex flex-wrap gap-2">
                {[["interval", "A cada intervalo"], ["daily", "Diário"], ["weekly", "Semanal"], ["monthly", "Mensal"]].map(([k, l]) => (
                  <button key={k} onClick={() => setForm((f) => ({ ...f, repeatKind: k }))} className={cn("px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors", form.repeatKind === k ? "bg-brand-600 border-brand-500 text-bone" : "border-hair-2 text-mist hover:bg-raised")}>{l}</button>
                ))}
              </div>

              {form.repeatKind === "interval" && (
                <div className="flex gap-2 items-end">
                  <Field label="A cada"><input type="number" min="1" className={cn(INPUT, "w-24")} value={form.intervalEvery} onChange={(e) => setForm((f) => ({ ...f, intervalEvery: e.target.value }))} /></Field>
                  <select className={cn(SELECT, "w-32")} value={form.intervalUnit} onChange={(e) => setForm((f) => ({ ...f, intervalUnit: e.target.value }))}>
                    <option value="minutes">Minutos</option>
                    <option value="hours">Horas</option>
                  </select>
                </div>
              )}
              {form.repeatKind !== "interval" && (
                <Field label="Horário"><input type="time" className={cn(INPUT, "w-40")} value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></Field>
              )}
              {form.repeatKind === "weekly" && (
                <div>
                  <div className="text-xs font-medium text-mut mb-1.5 uppercase tracking-wide">Dias da semana</div>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((d) => (
                      <button key={d.v} onClick={() => toggleDay(d.v)} className={cn("px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors", form.weeklyDays.includes(d.v) ? "bg-brand-600 border-brand-500 text-bone" : "border-hair-2 text-mist hover:bg-raised")}>{d.l}</button>
                    ))}
                  </div>
                </div>
              )}
              {form.repeatKind === "monthly" && (
                <Field label="Dia do mês"><input type="number" min="1" max="31" className={cn(INPUT, "w-24")} value={form.monthlyDay} onChange={(e) => setForm((f) => ({ ...f, monthlyDay: e.target.value }))} /></Field>
              )}

              <Field label="Cron gerado"><input className={cn(INPUT, "font-mono cursor-default")} value={cron} readOnly /></Field>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-raised border border-hair rounded-2xl p-4 space-y-2">
              <div className="text-sm font-display font-semibold text-bone">Próximas execuções</div>
              <div className="text-xs text-mut space-y-1">
                {preview.length === 0 && <div>Expressão Cron inválida.</div>}
                {preview.map((r, i) => <div key={i}>{new Date(r).toLocaleString("pt-BR")}</div>)}
              </div>
            </div>
            <div className="bg-raised border border-hair rounded-2xl p-4 space-y-3">
              <div className="text-sm font-display font-semibold text-bone">Limites</div>
              <Field label="Envios por minuto"><input type="number" min="1" className={INPUT} value={form.throttlePerMinute} onChange={(e) => setForm((f) => ({ ...f, throttlePerMinute: e.target.value }))} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Silêncio início"><input type="time" className={INPUT} value={form.quietStart} onChange={(e) => setForm((f) => ({ ...f, quietStart: e.target.value }))} /></Field>
                <Field label="Silêncio fim"><input type="time" className={INPUT} value={form.quietEnd} onChange={(e) => setForm((f) => ({ ...f, quietEnd: e.target.value }))} /></Field>
              </div>
            </div>
            <button onClick={save} className="w-full rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 font-medium text-sm transition-colors">{editing ? "Salvar alterações" : "Criar automação"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: AGENDAMENTOS (state key "templates")
   ════════════════════════════════════════════════════════════════════ */
const SCHED_STATUS = {
  pending: "bg-raised-2 text-mist", queued: "bg-brand-500/20 text-brand-400",
  sent: "bg-signal/15 text-signal", failed: "bg-red-400/15 text-red-300",
  cancelled: "bg-raised text-mut",
};
function ScheduledView({ toast }) {
  const agenda = useAgenda();
  const [list, setList] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const blank = { phone: "", contactName: "", name: "", message: "", templateId: "", scheduledAt: "" };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    try { const [s, t] = await Promise.all([api("scheduled"), api("templates")]); setList(s); setTemplates(t); } catch { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(blank); setOpen(true); }
  async function save() {
    if (!form.phone || !form.message || !form.scheduledAt) { toast("Destinatário, mensagem e data são obrigatórios.", "red"); return; }
    try {
      await api("scheduled", { method: "POST", body: { phoneE164: form.phone, contactName: form.contactName, name: form.name, message: form.message, templateId: form.templateId || null, scheduledAt: new Date(form.scheduledAt).toISOString() } });
      toast("Agendamento criado.", "indigo"); setOpen(false); await load();
    } catch (e) { toast("Erro: " + e.message, "red"); }
  }
  async function cancel(id) { try { await api(`scheduled/${id}/cancel`, { method: "POST" }); toast("Agendamento cancelado.", "slate"); await load(); } catch (e) { toast("Erro: " + e.message, "red"); } }
  async function del(id) { if (!confirm("Excluir este agendamento?")) return; try { await api(`scheduled/${id}`, { method: "DELETE" }); await load(); } catch (e) { toast("Erro: " + e.message, "red"); } }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Agendamentos</h1>
          <p className="text-sm text-mut mt-1">Mensagens únicas agendadas para uma data e hora específicas.</p>
        </div>
        <div className="flex items-center gap-2">
          <BackupBar label="agendamentos" toast={toast}
            onExport={() => api("scheduled")}
            onImport={async (arr) => { const items = Array.isArray(arr) ? arr : (arr.scheduled || []); let n = 0; for (const it of items) { try { const { _id, createdAt, updatedAt, __v, ...rest } = it; await api("scheduled", { method: "POST", body: rest }); n++; } catch {} } await load(); return n; }} />
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-signal hover:opacity-90 text-ink text-sm transition-colors"><Plus className="h-4 w-4" /> Novo Agendamento</button>
        </div>
      </div>

      <div className="bg-ink-2 border border-hair rounded-2xl overflow-hidden">
        <div className="grid grid-cols-12 bg-raised text-xs font-semibold text-mist border-b border-hair px-4 py-3">
          <div className="col-span-3">Destinatário</div>
          <div className="col-span-4">Mensagem</div>
          <div className="col-span-2">Data / Hora</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-2">Ações</div>
        </div>
        {list.length === 0 && <div className="px-4 py-10 text-center text-mut text-sm">Nenhum agendamento criado</div>}
        {list.map((c) => (
          <div key={c._id} className="grid grid-cols-12 border-b border-hair px-4 py-3 text-sm hover:bg-raised transition-colors items-center">
            <div className="col-span-3">
              <div className="font-medium text-bone">{agendaResolve(agenda, c.phoneE164) || c.contactName || c.name || "—"}</div>
              <div className="text-xs text-mut font-mono">{c.phoneE164}</div>
              {c.templateId && <div className="text-xs text-brand-400 mt-0.5">Template: {c.templateId.name}</div>}
            </div>
            <div className="col-span-4 text-mist text-xs pr-3 line-clamp-2">{c.message}</div>
            <div className="col-span-2 text-xs text-mist">{new Date(c.scheduledAt).toLocaleString("pt-BR")}</div>
            <div className="col-span-1"><span className={cn("px-2 py-1 rounded-full text-xs font-medium", SCHED_STATUS[c.status] || "bg-raised-2 text-mist")}>{c.status}</span></div>
            <div className="col-span-2 flex gap-1">
              {(c.status === "pending" || c.status === "queued") && <button onClick={() => cancel(c._id)} className="p-1.5 rounded-lg border border-hair-2 hover:bg-amber-400/10 text-amber-600 hover:text-amber-300 transition-colors" title="Cancelar"><X className="h-3.5 w-3.5" /></button>}
              <button onClick={() => del(c._id)} className="p-1.5 rounded-lg border border-hair-2 hover:bg-red-500/10 text-red-600 hover:text-red-300 transition-colors" title="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} title="Novo Agendamento" onClose={() => setOpen(false)}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-3xl">
          <div className="space-y-4">
            <Field label="Destinatário *"><ContactPicker value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} onPickContact={(c) => setForm((f) => ({ ...f, phone: c.phone || "", contactName: c.name || "" }))} source="agenda" /></Field>
            <Field label="Descrição (opcional)"><input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Lembrete para João" /></Field>
            <Field label="Template (opcional)">
              <select className={SELECT} value={form.templateId} onChange={(e) => { const t = templates.find((x) => x._id === e.target.value); setForm((f) => ({ ...f, templateId: e.target.value, message: t ? t.body : f.message })); }}>
                <option value="">Sem template</option>
                {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Data e hora *"><input type="datetime-local" className={INPUT} value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} /></Field>
          </div>
          <div className="space-y-4">
            <Field label="Mensagem *"><textarea className={cn(INPUT, "min-h-[180px] resize-y")} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="Texto da mensagem..." /></Field>
            <button onClick={save} className="w-full rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 font-medium text-sm transition-colors">Agendar mensagem</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: ESTEIRA (pipeline)  — abas: Esteira / Semanas / Onboarding
   ════════════════════════════════════════════════════════════════════ */
const PIPE_STATUS = {
  onboarding: { label: "Onboarding", color: "bg-purple-500/20 text-purple-400" },
  week1: { label: "Semana 1", color: "bg-brand-500/20 text-brand-400" },
  week2: { label: "Semana 2", color: "bg-blue-500/20 text-blue-400" },
  week3: { label: "Semana 3", color: "bg-cyan-500/20 text-cyan-400" },
  renewed: { label: "Renovado", color: "bg-signal/15 text-signal" },
  ended: { label: "Encerrado", color: "bg-raised-2 text-mut" },
};
function PipelineView({ toast }) {
  const agenda = useAgenda();
  const [tab, setTab] = useState("esteira"); // esteira | semanas | onboarding
  const [contacts, setContacts] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [onb, setOnb] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ phone: "", name: "" });
  const importRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [c, m, pc, oc] = await Promise.all([api("pipeline/contacts"), api("pipeline/metrics"), api("pipeline/config"), api("onboarding/config")]);
      setContacts(c); setMetrics(m); setCfg(pc); setOnb(oc);
    } catch { /* */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addToPipeline() {
    if (!form.phone) { toast("Informe o número.", "red"); return; }
    try { await api("pipeline/contacts", { method: "POST", body: { phoneE164: form.phone, name: form.name } }); toast("Cliente adicionado à esteira.", "indigo"); setOpen(false); setForm({ phone: "", name: "" }); await load(); }
    catch (e) { toast("Erro: " + e.message, "red"); }
  }
  async function renew(id) { try { await api(`pipeline/contacts/${id}/renew`, { method: "POST" }); toast("Cliente renovado.", "emerald"); await load(); } catch (e) { toast("Erro: " + e.message, "red"); } }
  async function end(id) { try { await api(`pipeline/contacts/${id}/end`, { method: "POST" }); toast("Cliente encerrado.", "slate"); await load(); } catch (e) { toast("Erro: " + e.message, "red"); } }
  async function del(id) { if (!confirm("Remover da esteira?")) return; try { await api(`pipeline/contacts/${id}`, { method: "DELETE" }); await load(); } catch (e) { toast("Erro: " + e.message, "red"); } }

  async function saveCfg() { try { await api("pipeline/config", { method: "PUT", body: cfg }); toast("Mensagens das semanas salvas.", "indigo"); } catch (e) { toast("Erro: " + e.message, "red"); } }
  async function saveOnb() { try { await api("onboarding/config", { method: "PUT", body: onb }); toast("Onboarding salvo.", "indigo"); } catch (e) { toast("Erro: " + e.message, "red"); } }

  function exportJson() {
  // Backup COMPLETO da esteira: clientes + mensagens das semanas + onboarding.
  const payload = {
    _type: "autoflow-esteira",
    version: 2,
    exportedAt: new Date().toISOString(),
    pipelineContacts: contacts,
    pipelineConfig: cfg || null,
    onboardingConfig: onb || null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `esteira-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  const parts = [`${contacts.length} cliente(s)`];
  if (cfg?.weeks?.length) parts.push(`${cfg.weeks.length} semana(s)`);
  if (onb?.steps?.length) parts.push(`${onb.steps.length} passo(s) de onboarding`);
  toast(`Backup baixado: ${parts.join(", ")}.`, "emerald");
}
async function importJson(e) {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // Retrocompat: backup antigo era um array puro de contatos da esteira.
    const isV2 = parsed && !Array.isArray(parsed) && (parsed._type === "autoflow-esteira" || parsed.pipelineContacts || parsed.pipelineConfig || parsed.onboardingConfig);
    const items = Array.isArray(parsed) ? parsed : (parsed.pipelineContacts || parsed.contacts || []);
    const done = [];
    // 1) Clientes da esteira (idempotente via upsert no backend)
    if (Array.isArray(items) && items.length) {
      const res = await api("pipeline/contacts/import", { method: "POST", body: items });
      done.push(`${res.inserted} adicionado(s), ${res.updated} atualizado(s)`);
    }
    // 2) Mensagens das semanas (substitui a config atual pela do backup)
    if (isV2 && parsed.pipelineConfig) {
      const { _id, __v, createdAt, updatedAt, ...pc } = parsed.pipelineConfig;
      await api("pipeline/config", { method: "PUT", body: pc });
      done.push("semanas restauradas");
    }
    // 3) Onboarding (substitui a sequência atual pela do backup)
    if (isV2 && parsed.onboardingConfig) {
      const { _id, __v, createdAt, updatedAt, ...oc } = parsed.onboardingConfig;
      await api("onboarding/config", { method: "PUT", body: oc });
      done.push("onboarding restaurado");
    }
    toast(`Importação concluída: ${done.join(" · ") || "nada a restaurar"}`, "indigo");
    await load();
  } catch { toast("Arquivo inválido. Selecione um backup .json válido.", "red"); }
  finally { e.target.value = ""; }
}

  const onbSteps = onb?.steps || [];
  function updateStep(i, patch) { const steps = [...onbSteps]; steps[i] = { ...steps[i], ...patch }; setOnb((o) => ({ ...o, steps })); }
  function addStep() { setOnb((o) => ({ ...o, steps: [...(o.steps || []), { order: (o.steps?.length || 0) + 1, type: "text", content: "", mediaUrl: "", delayAfterPrev: 0 }] })); }
  function removeStep(i) { setOnb((o) => ({ ...o, steps: o.steps.filter((_, idx) => idx !== i) })); }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Esteira de Produção</h1>
          <p className="text-sm text-mut mt-0.5">Onboarding → Semana 1 → 2 → 3 → Dia 30</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => importRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-raised hover:bg-raised text-mist text-sm transition-colors border border-hair"><Upload className="h-4 w-4" /> Importar</button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importJson} />
          <button onClick={exportJson} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-raised hover:bg-raised text-mist text-sm transition-colors border border-hair"><Download className="h-4 w-4" /> Backup</button>
          <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-signal hover:opacity-90 text-ink text-sm transition-colors"><Plus className="h-4 w-4" /> Adicionar à Esteira</button>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[["onboarding", metrics.onboarding], ["week1", metrics.week1], ["week2", metrics.week2], ["week3", metrics.week3], ["renewed", metrics.renewed], ["ended", metrics.ended]].map(([k, v]) => (
            <div key={k} className="bg-gradient-to-b from-raised to-ink-2 border border-hair rounded-xl p-3 text-center">
              <div className="font-display font-semibold text-[23px] tracking-tight text-bone">{v || 0}</div>
              <div className="text-xs text-mut">{PIPE_STATUS[k].label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-b border-hair pb-2">
        {[["esteira", "Esteira"], ["semanas", "Mensagens das Semanas"], ["onboarding", "Onboarding"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("px-4 py-2 rounded-xl text-sm font-medium transition-colors", tab === k ? "bg-brand-600 text-bone" : "text-mist hover:text-bone")}>{l}</button>
        ))}
      </div>

      {tab === "esteira" && (
        <div className="bg-ink-2 border border-hair rounded-2xl overflow-hidden">
          <div className="grid grid-cols-12 bg-raised text-xs font-semibold text-mist border-b border-hair px-4 py-3">
            <div className="col-span-3">Cliente</div><div className="col-span-2">WhatsApp</div><div className="col-span-2">Status</div><div className="col-span-2">Entrou em</div><div className="col-span-3">Ações</div>
          </div>
          {contacts.length === 0 && <div className="py-10 text-center text-mut text-sm">Nenhum cliente na esteira</div>}
          {contacts.map((c) => {
            const st = PIPE_STATUS[c.status] || PIPE_STATUS.ended;
            return (
              <div key={c._id} className="grid grid-cols-12 border-b border-hair px-4 py-3 text-sm hover:bg-raised transition-colors items-center">
                <div className="col-span-3 font-medium text-bone">{agendaResolve(agenda, c.phoneE164) || c.name || "Sem nome"}</div>
                <div className="col-span-2 text-mist font-mono text-xs">{c.phoneE164}</div>
                <div className="col-span-2 text-xs"><span className={cn("px-2 py-1 rounded-full font-medium", st.color)}>{st.label}</span></div>
                <div className="col-span-2 text-xs text-mut">{new Date(c.enteredAt).toLocaleDateString("pt-BR")}</div>
                <div className="col-span-3 flex gap-1.5">
                  <button onClick={() => renew(c._id)} className="text-xs px-2 py-1 rounded-lg border border-emerald-900/50 hover:bg-signal/10 text-signal transition-colors">Renovar</button>
                  <button onClick={() => end(c._id)} className="text-xs px-2 py-1 rounded-lg border border-hair hover:bg-raised text-mist transition-colors">Encerrar</button>
                  <button onClick={() => del(c._id)} className="text-xs px-2 py-1 rounded-lg border border-hair-2 hover:bg-red-500/10 text-red-300 transition-colors">Remover</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "semanas" && cfg && (
        <div className="space-y-4 max-w-2xl">
          {(cfg.weeks || []).map((w, i) => (
            <div key={i} className="bg-raised border border-hair rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-bone">Semana {w.week} (dia {w.dayTrigger})</div>
                <input type="time" className={cn(INPUT, "w-32")} value={w.sendTime} onChange={(e) => { const weeks = [...cfg.weeks]; weeks[i] = { ...weeks[i], sendTime: e.target.value }; setCfg((c) => ({ ...c, weeks })); }} />
              </div>
              <textarea className={cn(INPUT, "min-h-[80px] resize-y")} value={w.message} onChange={(e) => { const weeks = [...cfg.weeks]; weeks[i] = { ...weeks[i], message: e.target.value }; setCfg((c) => ({ ...c, weeks })); }} placeholder={`Ex: Olá {{nome}}! Chegou a semana ${w.week} do seu plano. Aproveite ao máximo!`} />
            </div>
          ))}
          <div className="bg-raised border border-hair rounded-2xl p-4 space-y-2">
            <div className="text-sm font-semibold text-bone">Mensagem de renovação</div>
            <textarea className={cn(INPUT, "min-h-[80px] resize-y")} value={cfg.renewalMessage || ""} onChange={(e) => setCfg((c) => ({ ...c, renewalMessage: e.target.value }))} placeholder="Olá {{nome}}! Sua jornada terminou — bora renovar?" />
          </div>
          <button onClick={saveCfg} className="rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 px-6 font-medium text-sm transition-colors">Salvar mensagens</button>
        </div>
      )}

      {tab === "onboarding" && onb && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between bg-raised border border-hair rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-medium text-bone">Onboarding ativo</div>
              <div className="text-xs text-mut">Dispara a sequência abaixo após o cadastro.</div>
            </div>
            <button onClick={() => setOnb((o) => ({ ...o, active: !o.active }))} className={cn("relative w-12 h-6 rounded-full transition-colors", onb.active ? "bg-brand-600" : "bg-hair-2")}>
              <span className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow", onb.active ? "left-7" : "left-1")} />
            </button>
          </div>
          <Field label="Delay após cadastro (minutos)"><input type="number" min="0" className={cn(INPUT, "w-40")} value={onb.delayMin ?? 30} onChange={(e) => setOnb((o) => ({ ...o, delayMin: Number(e.target.value) }))} /></Field>
          <div className="text-sm font-medium text-bone">Sequência de mensagens</div>
          {onbSteps.map((s, i) => (
            <div key={i} className="bg-ink-2 border border-hair rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-bone">Passo {i + 1}</div>
                <button onClick={() => removeStep(i)} className="text-mut hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="flex gap-2">
                <select className={cn(SELECT, "w-36 text-sm py-1")} value={s.type} onChange={(e) => updateStep(i, { type: e.target.value })}>
                  <option value="text">Texto</option><option value="audio">Áudio</option><option value="image">Imagem</option><option value="video">Vídeo</option><option value="document">Documento</option>
                </select>
                <input type="number" min="0" className={cn(INPUT, "w-32")} value={s.delayAfterPrev} onChange={(e) => updateStep(i, { delayAfterPrev: Number(e.target.value) })} placeholder="Delay (min)" />
              </div>
              <textarea className={cn(INPUT, "min-h-[70px] resize-y")} value={s.content} onChange={(e) => updateStep(i, { content: e.target.value })} placeholder={s.type === "audio" ? "Legenda/observação (opcional — o áudio vai como mensagem de voz)" : "Texto da mensagem"} />
              {s.type !== "text" && (
                <div className="space-y-2">
                  <input className={INPUT} value={s.mediaUrl || ""} onChange={(e) => updateStep(i, { mediaUrl: e.target.value })} placeholder={s.type === "audio" ? "Referência do áudio (ex.: local:....ogg)" : "URL / referência da mídia"} />
                  <MediaUpload type={s.type} onUploaded={(refUrl) => updateStep(i, { mediaUrl: refUrl })} toast={toast} />
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-3">
            <button onClick={addStep} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-hair text-mist hover:bg-raised text-sm transition-colors"><Plus className="h-4 w-4" /> Adicionar passo</button>
            <button onClick={saveOnb} className="rounded-xl bg-signal hover:opacity-90 text-ink py-2 px-6 font-medium text-sm transition-colors">Salvar onboarding</button>
          </div>
        </div>
      )}

      <Modal open={open} title="Adicionar à Esteira" onClose={() => setOpen(false)}>
        <div className="space-y-4 max-w-md">
          <Field label="WhatsApp *"><ContactPicker value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} onPickContact={(c) => setForm((f) => ({ ...f, phone: c.phone || "", name: c.name || "" }))} /></Field>
          <Field label="Nome (opcional)"><input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <div className="flex gap-3 pt-1">
            <button onClick={addToPipeline} className="flex-1 rounded-xl bg-signal hover:opacity-90 text-ink py-2.5 font-medium text-sm transition-colors">Adicionar</button>
            <button onClick={() => setOpen(false)} className="px-4 rounded-xl border border-hair text-mist hover:bg-raised text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: ASSINATURAS (subs)
   ════════════════════════════════════════════════════════════════════ */
function SubscriptionsView({ toast }) {
  const agenda = useAgenda();
  const [m, setM] = useState(null);
  const [notif, setNotif] = useState(() => {
    try { const c = localStorage.getItem("autoflow_notif_texts"); if (c) return JSON.parse(c); } catch { /* */ }
    return { d7: "Olá {{nome}}! Sua assinatura vence em 7 dias.", d1: "Atenção {{nome}}! Sua assinatura vence amanhã.", d0: "Olá {{nome}}! Sua assinatura expira hoje." };
  });
  const [view, setView] = useState("expiring");
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(null);

  useEffect(() => { api("subscriptions/metrics").then(setM).catch(() => {}); }, []);
  useEffect(() => {
    const ep = view === "expiring" ? "subscriptions/expiring?days=30" : "subscriptions/expired";
    api(ep).then(setRows).catch(() => setRows([]));
  }, [view]);

  function saveNotif() { localStorage.setItem("autoflow_notif_texts", JSON.stringify(notif)); }
  function reload() {
    api("subscriptions/metrics").then(setM).catch(() => {});
    const ep = view === "expiring" ? "subscriptions/expiring?days=30" : "subscriptions/expired";
    api(ep).then(setRows).catch(() => setRows([]));
  }
  async function saveSub() {
    if (!modal.phone) { toast && toast("Informe o WhatsApp.", "red"); return; }
    try {
      await api("contacts", { method: "POST", body: { phoneE164: modal.phone, name: modal.name || "", tags: [], subscriptionStart: modal.subscriptionStart || null, subscriptionEnd: modal.subscriptionEnd || null, subscriptionNotes: modal.subscriptionNotes || "", optIn: true } });
      toast && toast("Assinante incluído.", "emerald"); setModal(null); reload();
    } catch (e) { toast && toast("Erro: " + e.message, "red"); }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-mist" />
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Assinaturas</h1>
        </div>
        <div className="flex items-center gap-2">
          <BackupBar label="assinantes" toast={toast}
            onExport={async () => { const all = await api("contacts"); return (all || []).filter((c) => c.subscriptionEnd); }}
            onImport={async (arr) => { const items = Array.isArray(arr) ? arr : (arr.contacts || []); let n = 0; for (const c of items) { try { await api("contacts", { method: "POST", body: { phoneE164: c.phoneE164 || c.phone, name: c.name || "", tags: c.tags || [], subscriptionStart: c.subscriptionStart || null, subscriptionEnd: c.subscriptionEnd || null, subscriptionNotes: c.subscriptionNotes || "", optIn: true } }); n++; } catch {} } reload(); return n; }} />
          <button onClick={() => setModal({ name: "", phone: "", subscriptionStart: "", subscriptionEnd: "", subscriptionNotes: "" })} className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-signal hover:opacity-90 text-ink text-sm font-semibold transition-opacity"><Plus className="h-4 w-4" /> Incluir assinante</button>
        </div>
      </div>

      {m && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[["Total", m.total, "border-hair text-mist"], ["Ativos", m.active, "border-signal/50 text-signal bg-signal/10"], ["Vencendo 7d", m.expiring7dCount, "border-amber-400/50 text-amber-300 bg-amber-400/10"], ["Vence Hoje", m.expiringTodayCount, "border-amber-400/50 text-amber-300 bg-amber-400/10"], ["Vencidos", m.expired, "border-red-400/50 text-red-300 bg-red-500/10"]].map(([l, v, cls], i) => (
            <div key={i} className={cn("rounded-2xl border p-4", cls)}>
              <div className="text-2xl font-bold">{v ?? 0}</div>
              <div className="text-xs mt-0.5 opacity-80">{l}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-ink-2 border border-hair rounded-2xl p-4 space-y-3">
        <div className="text-sm font-semibold text-bone">Textos de Aviso de Vencimento</div>
        <Field label="7 dias antes"><input className={INPUT} value={notif.d7} onChange={(e) => setNotif((n) => ({ ...n, d7: e.target.value }))} /></Field>
        <Field label="1 dia antes"><input className={INPUT} value={notif.d1} onChange={(e) => setNotif((n) => ({ ...n, d1: e.target.value }))} /></Field>
        <Field label="No dia"><input className={INPUT} value={notif.d0} onChange={(e) => setNotif((n) => ({ ...n, d0: e.target.value }))} /></Field>
        <button onClick={saveNotif} className="rounded-xl bg-signal hover:opacity-90 text-ink py-2 px-5 font-medium text-sm transition-colors">Salvar textos</button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setView("expiring")} className={cn("px-4 py-2 rounded-xl text-sm font-medium border transition-colors", view === "expiring" ? "bg-amber-600/20 border-amber-500 text-amber-300" : "border-hair text-mist")}>Vencendo em 30d</button>
        <button onClick={() => setView("expired")} className={cn("px-4 py-2 rounded-xl text-sm font-medium border transition-colors", view === "expired" ? "bg-red-600/20 border-red-500 text-red-300" : "border-hair text-mist")}>Vencidos ({m?.expired ?? 0})</button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-mut text-sm">Nenhum cliente nesta lista.</div>}
        {rows.map((c) => (
          <div key={c._id} className="flex items-center justify-between bg-raised border border-hair hover:border-hair-2 rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-medium text-bone">{agendaResolve(agenda, c.phoneE164) || c.name || "Sem nome"}</div>
              <div className="text-xs text-mut mt-0.5 font-mono">{c.phoneE164}</div>
            </div>
            <div className="text-xs text-mist">{c.subscriptionEnd ? new Date(c.subscriptionEnd).toLocaleDateString("pt-BR") : "—"}</div>
          </div>
        ))}
      </div>

      <Modal open={!!modal} title="Incluir assinante" onClose={() => setModal(null)}>
        {modal && (
          <div className="space-y-3 max-w-lg">
            <Field label="Nome"><input className={INPUT} value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></Field>
            <Field label="WhatsApp (com DDD)"><ContactPicker value={modal.phone} onChange={(v) => setModal({ ...modal, phone: v })} onPickContact={(c) => setModal({ ...modal, phone: c.phone || "", name: c.name || modal.name })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Início"><input type="date" className={INPUT} value={modal.subscriptionStart} onChange={(e) => setModal({ ...modal, subscriptionStart: e.target.value })} /></Field>
              <Field label="Vencimento"><input type="date" className={INPUT} value={modal.subscriptionEnd} onChange={(e) => setModal({ ...modal, subscriptionEnd: e.target.value })} /></Field>
            </div>
            <Field label="Observações"><input className={INPUT} value={modal.subscriptionNotes} onChange={(e) => setModal({ ...modal, subscriptionNotes: e.target.value })} /></Field>
            <div className="flex gap-2 pt-1">
              <button onClick={saveSub} className="rounded-xl bg-signal hover:opacity-90 text-ink py-2 px-5 font-medium text-sm">Salvar assinante</button>
              <button onClick={() => setModal(null)} className="rounded-xl border border-hair text-mist py-2 px-5 text-sm">Cancelar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: AUDITORIA (audit)
   ════════════════════════════════════════════════════════════════════ */
function AuditView() {
  const [list, setList] = useState([]);
  useEffect(() => { api("audit").then(setList).catch(() => {}); }, []);
  return (
    <div className="p-6 space-y-5">
      <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Auditoria</h1>
      <div className="bg-ink-2 border border-hair rounded-2xl overflow-hidden">
        <div className="grid grid-cols-12 bg-raised text-xs font-semibold text-mist border-b border-hair px-4 py-3">
          <div className="col-span-2">Quando</div><div className="col-span-2">Quem</div><div className="col-span-2">Ação</div><div className="col-span-5">Detalhe</div><div className="col-span-1">OK</div>
        </div>
        {list.length === 0 && <div className="px-4 py-10 text-center text-mut text-sm">Sem registros.</div>}
        {list.map((c) => (
          <div key={c._id} className="grid grid-cols-12 border-b border-hair px-4 py-2.5 text-xs hover:bg-raised items-center">
            <div className="col-span-2 text-mist">{new Date(c.at).toLocaleString("pt-BR")}</div>
            <div className="col-span-2 text-mist truncate">{c.who}</div>
            <div className="col-span-2 text-brand-300 font-mono">{c.action}</div>
            <div className="col-span-5 text-mist truncate">{c.detail}</div>
            <div className="col-span-1">{c.ok === false ? <span className="text-red-300">✗</span> : <span className="text-signal">✓</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   TELA: WHATSAPP (whatsapp) — status + QR + contatos
   ════════════════════════════════════════════════════════════════════ */
function WhatsAppView({ toast }) {
  const [st, setSt] = useState({ status: "starting", qr: null });
  const [contacts, setContacts] = useState([]);
  const [disc, setDisc] = useState(false);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const s = await api("whatsapp/status");
        let qr = s.qr || null;
        if (s.status === "qr" && !qr) { try { const q = await api("whatsapp/qr"); qr = q.qr || null; } catch { /* */ } }
        if (alive) setSt({ status: s.status, qr });
      } catch { if (alive) setSt({ status: "disconnected", qr: null }); }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (st.status !== "connected") return;
    api("whatsapp/contacts?limit=1000").then((d) => setContacts(Array.isArray(d) ? d : [])).catch(() => {});
  }, [st.status]);

  async function disconnect() {
    if (!window.confirm("Desconectar a sessão do WhatsApp? Você precisará escanear o QR Code novamente para reconectar.")) return;
    setDisc(true);
    try {
      await api("whatsapp/disconnect", { method: "POST" });
      setSt({ status: "disconnected", qr: null });
      toast && toast("Sessão desconectada.", "slate");
    } catch {
      toast && toast("Desconexão ainda não disponível no backend (ativa no próximo deploy de backend).", "red");
    } finally { setDisc(false); }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[23px] tracking-tight text-bone">Conexão WhatsApp</h1>
          <p className="text-sm text-mut mt-0.5">Escaneie o QR Code para conectar a instância.</p>
        </div>
        <button onClick={disconnect} disabled={disc || st.status !== "connected"} className="flex items-center gap-2 px-3.5 py-2 rounded-[10px] border border-red-400/30 bg-red-400/5 hover:bg-red-400/15 text-red-300 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <X className="h-4 w-4" /> Desconectar sessão
        </button>
      </div>
      <div className="cad-sweep" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-ink-2 border border-hair rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-semibold text-bone">Status da conexão</div>
            <StatusDot status={st.status} />
          </div>
          {st.status === "connected"
            ? <div className="text-sm font-medium text-signal">WhatsApp conectado! Pronto para enviar mensagens.</div>
            : st.status === "qr"
              ? <div className="text-sm text-mist">QR Code disponível ao lado. Escaneie com o WhatsApp.</div>
              : <div className="text-sm text-mist">Aguardando conexão...</div>}
          <div className="text-xs text-mut mt-3">WhatsApp → Dispositivos conectados → Conectar dispositivo</div>
        </div>

        <div className="bg-ink-2 border border-hair rounded-2xl p-5">
          <div className="font-display font-semibold text-bone mb-4">QR Code</div>
          <div className="bg-white rounded-2xl flex items-center justify-center aspect-square max-w-[260px] mx-auto overflow-hidden">
            {st.qr
              ? <img src={st.qr} alt="QR Code" className="w-full h-full object-contain" />
              : <div className="text-center text-mut p-6">
                  {st.status === "connected"
                    ? <><CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-signal" /><div className="text-sm">Conectado!</div></>
                    : <div className="text-sm">Aguardando QR...</div>}
                </div>}
          </div>
        </div>
      </div>

      <div className="bg-ink-2 border border-hair rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-hair text-[11px] uppercase tracking-wide text-mut">Contatos do WhatsApp conectado</div>
        <div className="grid grid-cols-6 bg-raised text-[11px] font-semibold text-mut border-b border-hair px-4 py-3 uppercase tracking-wide">
          <div className="col-span-3">Nome</div><div className="col-span-3">WhatsApp</div>
        </div>
        {contacts.length === 0 && <div className="px-4 py-8 text-center text-mut text-sm">{st.status === "connected" ? "Nenhum contato carregado." : "Conecte o WhatsApp para ver contatos."}</div>}
        {contacts.slice(0, 200).map((c, i) => (
          <div key={(c.phone || "") + i} className="grid grid-cols-6 border-b border-hair px-4 py-2.5 text-sm items-center hover:bg-raised transition-colors">
            <div className="col-span-3 text-bone truncate">{c.name && c.name.trim() ? c.name : "(sem nome)"}{c.uncertain ? <span className="ml-1.5 text-amber-300 text-xs">• incerto</span> : null}</div>
            <div className="col-span-3 text-mist font-mono text-xs">{c.phone}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LOGIN (`Sm` no bundle)
   ════════════════════════════════════════════════════════════════════ */
function Login({ onLogged }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(""); setLoading(true);
    try { const r = await api("auth/login", { method: "POST", body: { email, password } }); setToken(r.token); onLogged(r.user); }
    catch { setErr("Credenciais inválidas"); }
    finally { setLoading(false); }
  }
  const fld = "w-full bg-ink border border-hair-2 text-bone rounded-xl px-3 py-2.5 text-sm placeholder:text-mut focus:outline-none focus:border-signal/60 focus:ring-1 focus:ring-signal/30 transition";
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-ink-2 border border-hair rounded-2xl overflow-hidden shadow-premium">
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-[38px] h-[38px] rounded-[11px] flex-none border border-hair-2 flex items-center justify-center" style={{ background: "radial-gradient(circle at 30% 25%, #2a3b36, #0d1311)" }}>
              <span className="w-3 h-3 rounded-full bg-signal cad-livedot" style={{ boxShadow: "0 0 0 3px rgba(63,224,162,.16), 0 0 14px #3FE0A2" }} />
            </div>
            <div>
              <div className="font-display font-bold text-bone text-lg tracking-tight leading-none">AutoFlow</div>
              <div className="text-[10px] text-mut tracking-[0.16em] uppercase mt-1">Cadence Console</div>
            </div>
          </div>
        </div>
        <div className="cad-sweep mx-6" />
        <div className="p-6 space-y-4">
          <div>
            <div className="text-[11px] font-medium text-mut mb-1.5 uppercase tracking-wide">Email</div>
            <input type="email" autoComplete="email" placeholder="seu@email.com" className={fld} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <div className="text-[11px] font-medium text-mut mb-1.5 uppercase tracking-wide">Senha</div>
            <input type="password" autoComplete="current-password" placeholder="••••••••" className={fld} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && <div className="bg-red-400/10 border border-red-400/25 rounded-xl px-4 py-2.5 text-sm text-red-300">{err}</div>}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-signal hover:opacity-90 disabled:opacity-50 text-ink py-2.5 font-semibold text-sm flex items-center justify-center gap-2 transition-opacity">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}{loading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SHELL + ROOT
   ════════════════════════════════════════════════════════════════════ */
const NAV = [
  { key: "dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { key: "contacts", label: "Clientes", icon: Users },
  { key: "pipeline", label: "Esteira", icon: Workflow },
  { key: "recurring", label: "Automações", icon: Repeat, badgeKey: "recurringActive" },
  { key: "autoReply", label: "Respostas Auto", icon: MessageSquareReply },
  { key: "templates", label: "Agendamentos", icon: CalendarClock },
  { key: "tpl", label: "Templates", icon: FileText },
  { key: "audit", label: "Auditoria", icon: ScrollText },
  { key: "subs", label: "Assinaturas", icon: CreditCard },
  { key: "backup", label: "Backup", icon: Database, href: "/backup.html" },
  { key: "conta", label: "Conta", icon: UserIcon, href: "/conta.html" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare },
];
const OPERACAO = ["dashboard", "contacts", "pipeline", "recurring", "autoReply", "templates", "tpl"];

function Shell({ user, onLogout }) {
  const [screen, setScreen] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [summary, setSummary] = useState({});
  const [waStatus, setWaStatus] = useState("starting");
  const [toast, showToast] = useToast();

  useEffect(() => { api("dashboard").then(setSummary).catch(() => {}); }, [screen]);
  useEffect(() => {
    let alive = true;
    async function poll() { try { const s = await api("whatsapp/status"); if (alive) setWaStatus(s.status); } catch { if (alive) setWaStatus("disconnected"); } }
    poll(); const id = setInterval(poll, 8000); return () => { alive = false; clearInterval(id); };
  }, []);

  function go(key) {
    setMenuOpen(false);
    const item = NAV.find((n) => n.key === key);
    if (item?.href) { window.location.href = item.href; return; }
    setScreen(key);
  }

  return (
    <div className="min-h-screen bg-transparent text-bone flex">
      <Toast toast={toast} />
      {menuOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={() => setMenuOpen(false)} />}
      {/* RAIL — console Cadence */}
      <aside className={cn("w-[236px] flex-shrink-0 border-r border-hair bg-gradient-to-b from-ink-2 to-ink flex flex-col fixed inset-y-0 left-0 z-50 h-screen transition-transform duration-200 md:sticky md:top-0 md:z-auto md:translate-x-0", menuOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-3 px-4 pt-[18px] pb-1">
          <div className="w-[30px] h-[30px] rounded-[9px] flex-none border border-hair-2 flex items-center justify-center" style={{ background: "radial-gradient(circle at 30% 25%, #2a3b36, #0d1311)" }}>
            <span className="w-[11px] h-[11px] rounded-full bg-signal" style={{ boxShadow: "0 0 0 3px rgba(63,224,162,.16), 0 0 14px #3FE0A2" }} />
          </div>
          <div>
            <div className="font-display font-bold text-[16px] tracking-tight text-bone leading-none">AutoFlow</div>
            <div className="text-[10px] text-mut tracking-[0.16em] uppercase mt-1">Cadence</div>
          </div>
        </div>

        <nav className="flex-1 px-3.5 py-3 overflow-auto">
          <div className="text-[9.5px] tracking-[0.2em] uppercase text-mut px-2 pt-1.5 pb-1">Operação</div>
          <div className="space-y-0.5">
            {NAV.filter((n) => OPERACAO.includes(n.key)).map((n) => (
              <NavItem key={n.key} icon={n.icon} label={n.label} active={screen === n.key} onClick={() => go(n.key)} badge={n.badgeKey ? summary[n.badgeKey] || null : null} />
            ))}
          </div>
          <div className="text-[9.5px] tracking-[0.2em] uppercase text-mut px-2 pt-4 pb-1">Gestão</div>
          <div className="space-y-0.5">
            {NAV.filter((n) => !OPERACAO.includes(n.key)).map((n) => (
              <NavItem key={n.key} icon={n.icon} label={n.label} active={screen === n.key} onClick={() => go(n.key)} badge={n.badgeKey ? summary[n.badgeKey] || null : null} />
            ))}
          </div>
        </nav>

        <div className="p-3.5 space-y-2.5">
          <div className="border border-hair rounded-[13px] bg-raised p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] tracking-[0.14em] uppercase text-mut">WhatsApp</span>
              <StatusDot status={waStatus} />
            </div>
            <div className="cad-ekg mt-2.5 h-[26px] w-full overflow-hidden rounded-[7px] border border-hair" style={{ background: "linear-gradient(180deg,#0c1210,#0a0f0d)" }}>
              <svg viewBox="0 0 240 26" preserveAspectRatio="none" width="480" height="26" className="block">
                <g className="scan">
                  <polyline points="0,13 30,13 38,5 46,21 54,13 90,13 98,9 106,17 114,13 150,13 158,3 166,23 174,13 210,13 218,9 226,17 234,13 240,13" fill="none" stroke="#3FE0A2" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity={waStatus === "connected" ? ".9" : ".22"} />
                  <polyline points="240,13 270,13 278,5 286,21 294,13 330,13 338,9 346,17 354,13 390,13 398,3 406,23 414,13 450,13 458,9 466,17 474,13 480,13" fill="none" stroke="#3FE0A2" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity={waStatus === "connected" ? ".9" : ".22"} />
                </g>
              </svg>
            </div>
            <div className="text-[11px] text-mut mt-2 font-mono">instância default</div>
          </div>

          <div className="border border-hair rounded-[13px] bg-raised px-3 py-2">
            <div className="text-[10px] tracking-[0.14em] uppercase text-mut">Logado como</div>
            <div className="text-xs font-medium text-mist mt-0.5 truncate font-mono">{user.email}</div>
          </div>

          <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 rounded-[11px] bg-raised border border-hair hover:bg-red-500/10 hover:text-red-300 text-mut text-sm py-2 transition-colors">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="flex-1 overflow-auto min-w-0">
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-2.5 px-4 h-14 border-b border-hair bg-ink-2/95 backdrop-blur">
          <button onClick={() => setMenuOpen(true)} className="p-2 -ml-2 rounded-lg hover:bg-raised text-mist" aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-display font-bold text-[15px] tracking-tight text-bone">AutoFlow</span>
          <span className="text-[9px] text-mut tracking-[0.16em] uppercase mt-0.5">Cadence</span>
        </div>
        {screen === "dashboard" && <DashboardView onNavigate={go} />}
        {screen === "contacts" && <ContactsView toast={showToast} />}
        {screen === "pipeline" && <PipelineView toast={showToast} />}
        {screen === "recurring" && <RecurringView toast={showToast} />}
        {screen === "autoReply" && <AutoReplyView toast={showToast} />}
        {screen === "templates" && <ScheduledView toast={showToast} />}
        {screen === "tpl" && <TemplatesView toast={showToast} />}
        {screen === "audit" && <AuditView />}
        {screen === "subs" && <SubscriptionsView toast={showToast} />}
        {screen === "whatsapp" && <WhatsAppView toast={showToast} />}
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // valida o token existente tentando uma chamada autenticada
  useEffect(() => {
    let alive = true;
    (async () => {
      try { await api("dashboard"); if (alive) setUser({ email: "—", role: "admin" }); }
      catch { clearToken(); }
      finally { if (alive) setBooting(false); }
    })();
    return () => { alive = false; };
  }, []);

  function logout() { clearToken(); setUser(null); }

  if (booting) {
    return <div className="min-h-screen bg-transparent flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-400" /></div>;
  }
  if (!user) return <Login onLogged={setUser} />;
  return <Shell user={user} onLogout={logout} />;
}
