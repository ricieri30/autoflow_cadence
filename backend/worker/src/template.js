// template.js - engine unica de renderizacao de variaveis {{var}} (ESM)
export function render(body, vars) {
  if (body == null) return "";
  vars = vars || {};
  return String(body).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    const v = vars[key];
    // Preserva o placeholder original quando nao ha valor real,
    // para a variavel nunca "sumir" silenciosamente da mensagem.
    if (v === undefined || v === null || String(v).trim() === "") return m;
    return String(v);
  });
}
export function extractVars(body) {
  const out = new Set();
  String(body == null ? "" : body).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => { out.add(k); return m; });
  return Array.from(out);
}
export default { render, extractVars };
