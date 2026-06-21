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
| `34ae58f` | Este documento (README de pós-instalação) |

**Correção da auto-resposta (caso Solange):** as 2 regras que apontavam para o número fantasma 5515988008487 foram repontadas para o número real 5511981573014. Isso foi feito **direto no MongoDB** (não é código), então **persiste independentemente de deploy** — sobrevive a qualquer rebuild.

---

## 4. O que AINDA precisa ser revisado / refeito

| Pendência | Ação necessária | Quem faz |
|---|---|---|
| `.env` vazio (JWT_SECRET / ADMIN_PASSWORD em padrão) | Gerar segredo forte (openssl rand -hex 32) e senha de admin robusta. Risco de segurança. | **Usuário** (são segredos, não devem ser gerados por assistente) |
| Sincronização da pasta de deploy | Re-clonar/atualizar /docker/autoflow_cadence com o main ANTES de --build | Usuário, com roteiro preparado (seção 8) |
| HTTPS | Proxy reverso + certificado (domínio) | Futuro |
| Drift de versão do Baileys (^6.7.18) | Fixar versão e testar | Futuro |
| Healthchecks nos containers | Adicionar ao docker-compose | Futuro |
| Limpeza do volume de mídia | Rotina de limpeza de arquivos antigos | Futuro |
| express.json no gateway | Conferir se o gateway também precisa de limite alinhado (hoje a API já está em 32mb) | Futuro |

---

## 5. Caso de borda conhecido (auto-resposta)

O regex BR do commit `e7e7dfd` **NÃO bloqueia** o número fantasma da Solange, porque ele tem **formato BR válido** (passa no regex). A correção daquele caso específico foi feita no banco (seção 3).

**Blindagem completa (opcional, futuro):** validar o auto-cadastro via onWhatsApp no gateway, confirmando que o número realmente existe no WhatsApp antes de cadastrar. Isso bloquearia números de formato válido mas inexistentes/fantasma.

---

## 6. Fluxo de uma mensagem recebida (como a auto-resposta funciona)

1. Contato manda mensagem no WhatsApp → chega no **wa-gateway** (Baileys).
2. O gateway identifica o remetente. Para remetentes `@lid`, resolve o **número real** via `msg.key.senderPn` (campo senderPn). Sem isso, só teria o LID (um id interno) e a regra não casaria.
3. O gateway chama o webhook `POST /internal/message` na API, enviando: `from`, `text`, `pushName`, `fromLid`, `fromReal`, `replyTo`.
4. A API monta o conjunto de `candidates` (número real + LID) e faz **auto-cadastro** do contato (só número BR válido, sem sobrescrever nome já definido).
5. A API percorre as regras ativas e usa `evaluateRule(rule, text, candidates)`: confere palavra-chave (`keywordMatches`), janela de horário (`timeInRange`) e telefone-alvo (`normPhone`, tolerante aos últimos 8 dígitos / 9º dígito).
6. Se casar, renderiza a resposta com `{{nome}}` (1º nome da agenda) e envia via `WA_GATEWAY_URL/send`. Registra em Auditoria.

> **Por que a regra da Solange falhou e depois voltou:** antes do fix de senderPn, o gateway às vezes mandava só o LID. A regra apontava para o número real, então não casava. Quando o senderPn passou a resolver o número real, a regra voltou a casar — daí o "consertou sozinho depois de algumas horas".

---

## 7. Mapa dos arquivos-chave

| Arquivo | Papel |
|---|---|
| `backend/api/src/server.js` | Bootstrap da API: express.json (32mb), rate-limit de login, criação de admin, listen. |
| `backend/api/src/routes.js` | Todas as rotas REST + webhook `/internal/message` + auto-cadastro + upload-media (multer 32MB) + lógica de auto-resposta (evaluateRule). |
| `backend/api/src/models.js` | Schemas do Mongo (Contact, AutoReply, OnboardingConfig, etc.). Enum de step types inclui "audio". |
| `backend/wa-gateway/src/` | Conexão Baileys, QR/sessão, resolução de LID/senderPn, envio /send, webhook para a API. |
| `backend/worker/` | Consumidor BullMQ: disparos agendados e recorrentes com atraso anti-bloqueio. |
| `web/` | SPA React/Vite (tema Cadence) + nginx (client_max_body_size 32m). |
| `docker-compose.yml` | Orquestra os 6 serviços; padrões das variáveis de ambiente. |

---

## 8. Roteiro de deploy seguro (PREPARAR — não executar sem decisão)

> Estes comandos sincronizam o `main` para a pasta de deploy ANTES de buildar. Revise antes de rodar. O usuário executa.

```bash
# 1. Backup da pasta de deploy atual (segurança)
cd /docker
cp -r autoflow_cadence autoflow_cadence_backup_$(date +%Y%m%d_%H%M%S)

# 2. Trazer o código mais novo do GitHub para uma pasta limpa
git clone https://github.com/ricieri30/autoflow_cadence.git autoflow_cadence_new

# 3. Preservar o .env e quaisquer arquivos locais de config
cp autoflow_cadence/.env autoflow_cadence_new/.env   2>/dev/null || true

# 4. Substituir a pasta de deploy pela nova (já com o código corrigido)
#    (pare os containers antes se preferir: docker compose -f autoflow_cadence/docker-compose.yml down)
mv autoflow_cadence autoflow_cadence_old
mv autoflow_cadence_new autoflow_cadence

# 5. Subir já com o código novo
cd autoflow_cadence
docker compose up -d --build
```

**Antes do passo 5**, garanta o `.env` preenchido (seção 9). Depois do build, validar: login, conexão do WhatsApp (QR), envio de áudio e uma auto-resposta de teste.

---

## 9. Template de `.env` (o usuário preenche os segredos)

```env
# Gere o segredo com: openssl rand -hex 32
JWT_SECRET=COLOQUE_UM_VALOR_ALEATORIO_FORTE_AQUI
ADMIN_EMAIL=admin@admin.com
ADMIN_PASSWORD=TROQUE_POR_UMA_SENHA_FORTE
MIN_MESSAGE_DELAY_MS=2000
JITTER_MS=1000
# NOTICE_7D / NOTICE_1D / NOTICE_TODAY = textos de aviso de vencimento (opcionais)
```

> Os valores de JWT_SECRET e ADMIN_PASSWORD são segredos e devem ser definidos manualmente — nunca commitados no repositório.

---

## 10. Comandos de diagnóstico úteis

```bash
# Ver containers e status
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# Logs da API filtrando auto-resposta (com timestamp)
docker logs afcad_api -t 2>&1 | grep -E "Regra ativada|Nenhuma regra|internal/message"

# Conferir timezone do container da API
docker exec afcad_api date

# Logs do gateway (conexão / QR / senderPn)
docker logs afcad_gateway -t --tail 100

# Rodar um script utilitário .cjs dentro da API (mongoose disponível em /app)
docker cp meu_script.cjs afcad_api:/app/meu_script.cjs
docker exec -w /app afcad_api node meu_script.cjs
```

---

## 11. Notas técnicas úteis para manutenção

- O projeto é **ESM** (type: module). Scripts utilitários rodados manualmente no container devem usar extensão **.cjs** (require) ou import ESM.
- Para rodar script com mongoose dentro do container, copie para /app (docker cp) e rode com -w /app, senão não encontra o módulo mongoose.
- Lógica de match da auto-resposta: evaluateRule(rule, text, candidates) em backend/api/src/routes.js, usa keywordMatches, timeInRange, normPhone (match tolerante pelos últimos 8 dígitos).
- O webhook do gateway entra em POST /internal/message na API.
- Cache do raw.githubusercontent pode mostrar versão antiga; para verificação confiável use o blob view ou o .patch do commit (/commit/<hash>.patch).
- A correção da Solange vive no MongoDB (coleção AutoReply, campo targetPhone). Para conferir: buscar regras com targetPhone 5515988008487 (deve dar zero) e 5511981573014.

---

## 12. Glossário rápido

| Termo | Significado |
|---|---|
| **LID** | Identificador interno do WhatsApp para um contato (`...@lid`). Não é o número de telefone. |
| **senderPn** | Campo `msg.key.senderPn` que carrega o número real do remetente em mensagens `@lid`. Usado para resolver o telefone verdadeiro. |
| **ptt** | "Push to talk" — mensagem de voz de verdade no WhatsApp (áudio opus), diferente de anexar um arquivo de áudio. |
| **Contato-fantasma** | Contato criado por engano quando o LID não foi resolvido para o número real, gerando um número que não corresponde à pessoa. |
| **normPhone** | Função que normaliza telefones (só dígitos) e compara de forma tolerante (últimos 8 dígitos / 9º dígito BR). |
| **Esteira** | Fluxo de onboarding em etapas (texto, áudio, imagem, etc.) disparado após o cadastro. |

---

## 13. Resumo de uma linha

Código do `main` está pronto e verificado. Falta: (1) sincronizar a pasta de deploy com o main antes de buildar (seção 8), e (2) o usuário definir os segredos do .env (seção 9). A correção da Solange já vive no banco e não depende de deploy.
