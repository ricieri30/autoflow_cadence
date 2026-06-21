# README — Pós-Instalação / Handoff de Manutenção (AutoFlow Cadence)

> **Objetivo deste arquivo:** servir de memória de continuidade. Se a sessão de quem opera cair, qualquer pessoa (ou assistente) que ler este documento entende o estado atual do sistema, o que já foi corrigido, o que ainda precisa ser revisado/refeito e — principalmente — o cuidado crítico antes de fazer deploy.
>
> Última atualização: 2026-06-21.

---

## 1. Visão rápida do ambiente

| Item | Valor |
|---|---|
| Repositório (fonte da verdade do código) | github.com/ricieri30/autoflow_cadence — branch `main` |
| App em produção (UI) | http://2.25.145.110:4050/ |
| Pasta de deploy no VPS | `/docker/autoflow_cadence` (**NÃO é um repositório git**) |
| Containers | afcad_web, afcad_api, afcad_worker, afcad_gateway, afcad_mongo, afcad_redis |
| Timezone do afcad_api | America/Sao_Paulo (correto) |

---

## 2. ⚠️ AVISO CRÍTICO ANTES DE QUALQUER DEPLOY

A pasta `/docker/autoflow_cadence` no VPS **não é um clone git** e ainda contém **código ANTIGO (pré-correções)**.

**Rodar `docker compose up -d --build` nessa pasta, do jeito que ela está, APAGARIA todas as correções já ativas em produção.**

Antes de qualquer `--build`, é OBRIGATÓRIO sincronizar o `main` do GitHub para dentro da pasta de deploy (re-clonar ou substituir `backend/` e `web/`). Só depois buildar.

Correções que seriam perdidas num build sem sincronizar:
- Áudio ptt (mensagem de voz real)
- Resolução senderPn / LID (número real do remetente)
- Variável `{{nome}}` resolvida pela agenda
- nginx com limite 32m
- multer com limite 32MB
- express.json com limite 32mb
- Auto-cadastro só aceitando número BR válido

---

## 3. O que JÁ está corrigido e commitado em `main`

| Commit | O que faz |
|---|---|
| (live) áudio ptt | Conversão ffmpeg para opus no gateway; rota /upload-media na API |
| (live) senderPn/LID | Resolve número real do remetente além do LID |
| (live) {{nome}} | Resolve pelo 1º nome da agenda, tolerante ao 9º dígito |
| (live) nginx 32m | Limite de upload no nginx |
| `3b90f15` | multer fileSize 25 para 32MB |
| `e7e7dfd` | Auto-cadastro só aceita número BR válido (regex 55 + 10/11 dígitos) |
| `4e28332` | express.json limit 10mb para 32mb (alinha com nginx e multer) |

**Correção da auto-resposta (caso Solange):** as 2 regras que apontavam para o número fantasma 5515988008487 foram repontadas para o número real 5511981573014. Isso foi feito **direto no MongoDB** (não é código), então **persiste independentemente de deploy** — sobrevive a qualquer rebuild.

---

## 4. O que AINDA precisa ser revisado / refeito

| Pendência | Ação necessária | Quem faz |
|---|---|---|
| `.env` vazio (JWT_SECRET / ADMIN_PASSWORD em padrão) | Gerar segredo forte (openssl rand -hex 32) e senha de admin robusta. Risco de segurança. | **Usuário** (são segredos, não devem ser gerados por assistente) |
| Sincronização da pasta de deploy | Re-clonar/atualizar /docker/autoflow_cadence com o main ANTES de --build | Usuário, com roteiro preparado |
| HTTPS | Proxy reverso + certificado (domínio) | Futuro |
| Drift de versão do Baileys (^6.7.18) | Fixar versão e testar | Futuro |
| Healthchecks nos containers | Adicionar ao docker-compose | Futuro |
| Limpeza do volume de mídia | Rotina de limpeza de arquivos antigos | Futuro |

---

## 5. Caso de borda conhecido (auto-resposta)

O regex BR do commit `e7e7dfd` **NÃO bloqueia** o número fantasma da Solange, porque ele tem **formato BR válido** (passa no regex). A correção daquele caso específico foi feita no banco (seção 3).

**Blindagem completa (opcional, futuro):** validar o auto-cadastro via onWhatsApp no gateway, confirmando que o número realmente existe no WhatsApp antes de cadastrar. Isso bloquearia números de formato válido mas inexistentes/fantasma.

---

## 6. Notas técnicas úteis para manutenção

- O projeto é **ESM** (type: module). Scripts utilitários rodados manualmente no container devem usar extensão **.cjs** (require) ou import ESM.
- Para rodar script com mongoose dentro do container, copie para /app (docker cp) e rode com -w /app, senão não encontra o módulo mongoose.
- Lógica de match da auto-resposta: evaluateRule(rule, text, candidates) em backend/api/src/routes.js, usa keywordMatches, timeInRange, normPhone (match tolerante pelos últimos 8 dígitos).
- O webhook do gateway entra em POST /internal/message na API.
- Cache do raw.githubusercontent pode mostrar versão antiga; para verificação confiável use o blob view ou o .patch do commit (/commit/<hash>.patch).

---

## 7. Resumo de uma linha

Código do `main` está pronto e verificado. Falta: (1) sincronizar a pasta de deploy com o main antes de buildar, e (2) o usuário definir os segredos do .env. A correção da Solange já vive no banco e não depende de deploy.

