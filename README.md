# WhatsApp AutoFlow Claude — edição Premium

Stack completa em Docker Compose: frontend (React/Vite, tema **Premium**) + backend (API Express, Worker BullMQ, WA Gateway Baileys) + MongoDB + Redis, atrás de um **Caddy com HTTPS automático**. Pronta para `git push` → `docker compose up -d` numa VPS.

## Status

| Parte | Estado |
|-------|--------|
| `web/` (frontend SPA) | reconstruído; **novo tema Premium** (violeta/ametista + selo PREMIUM); builda OK |
| `backend/api/` | fonte recuperada + `package.json` reconstruído + **rate-limit no login** |
| `backend/worker/` | fonte recuperada + `package.json` reconstruído |
| `backend/wa-gateway/` | **reconstruído** (Baileys) — builda e responde aos contratos |
| `caddy/` | reverse proxy + **HTTPS automático** (Let's Encrypt) |
| `.github/workflows/ci.yml` | CI: build do front + checagem do backend + validação do compose |
| `docker-compose.yml` | produção, com **healthchecks** e `web` só no localhost |

## Identidade visual (como distinguir da versão antiga)

A versão antiga usava acento **azul/índigo**. Esta usa um tema **Premium violeta/ametista** com fundo quase-preto e brilho sutil, logo com gradiente e um selo dourado **PREMIUM** ao lado do nome (na sidebar e no login). Bateu o olho → é a nova.

## Estrutura

```
docker-compose.yml          PRODUÇÃO — 7 serviços (inclui Caddy)
.env.example                modelo de variáveis (copie para .env)
caddy/Caddyfile             proxy + HTTPS automático
.github/workflows/ci.yml    integração contínua
web/                        frontend Vite + nginx (tema Premium)
backend/
  api/                      Express + JWT + Mongo + BullMQ (+ rate-limit login)
  worker/                   consumidor BullMQ
  wa-gateway/               integração Baileys/WhatsApp
```

## Arquitetura

```
Caddy (HTTPS :80/:443)  -->  Web (nginx + SPA)  --/api-->  API (Express + JWT)  -->  MongoDB
                                                                  |                  Redis (BullMQ)
                                                                  v
                                                         Worker  -->  WA Gateway (Baileys)  -->  WhatsApp
```

O Caddy é a única porta pública. O `web` escuta só em `127.0.0.1:3025` (debug via túnel SSH). Mongo e Redis ficam apenas na rede interna do compose.

---

## 1) Subir no GitHub (repo privado)

```bash
cd /caminho/do/repo
git init
git add .
git commit -m "Edição Premium: stack completa + Caddy/HTTPS + CI + healthchecks"
git branch -M main
git remote add origin git@github.com:SUA_ORG/whatsapp-autoflow.git   # PRIVADO
git push -u origin main
```

`.gitignore` protege `node_modules/`, `dist/`, `.env` e a sessão do WhatsApp. **O `.env` nunca vai pro Git.**

## 2) Deploy na VPS

```bash
git clone git@github.com:SUA_ORG/whatsapp-autoflow.git
cd whatsapp-autoflow
cp .env.example .env && nano .env
#   - SITE_ADDRESS=app.seudominio.com   (HTTPS automático)  ou  :80 (só HTTP)
#   - JWT_SECRET = O MESMO da produção atual (senão os logins existentes caem)
#   - ADMIN_EMAIL / ADMIN_PASSWORD

# (VPS nova) restaure os volumes do backup ANTES de subir — ver "Migração"

docker compose up -d --build
docker compose ps          # confira os healthchecks "healthy"
```

- Com domínio em `SITE_ADDRESS`, o Caddy emite o certificado sozinho (aponte o DNS do domínio para o IP da VPS e libere as portas 80/443).
- **Primeira conexão do WhatsApp**: abra a tela **WhatsApp** (ou `GET /api/whatsapp/qr`) e escaneie. Se restaurou o volume `wa_auth`, já entra conectado sem QR.

## 3) Atualizações

```bash
git pull
docker compose up -d --build web     # ou o serviço alterado
```

---

## Reconfiguração operacional aplicada nesta versão

- **Caddy + HTTPS automático** como entrada pública (`caddy/Caddyfile`, env `SITE_ADDRESS`).
- **Healthchecks** em `api`, `wa-gateway` e `web` (via `/health` e nginx) — `depends_on`/`restart` mais confiáveis.
- **`web` sem porta pública** (só `127.0.0.1:3025`); Mongo/Redis só na rede interna.
- **Rate-limit no `/api/auth/login`** (20 tentativas / 15 min por IP) — aplicado no `server.js`, sem tocar no `routes.js` recuperado.
- **CI (GitHub Actions)**: a cada push/PR roda build do front, checagem de sintaxe do backend e `docker compose config`.
- **Lockfiles** versionados (`web` e `wa-gateway`) para builds reproduzíveis.

> Ainda recomendado: trocar `JWT_SECRET`/senha admin por valores fortes; somar uma **cópia externa** dos backups (object storage) ao `backup.sh`; e testar a restauração na stack isolada (`docker-compose.isolated.yml` da entrega anterior).

## Migração de VPS / recuperação de desastre

1. VPS nova: Docker + Compose.
2. `git clone` (a fonte agora está versionada — foi a falta disso que causou a perda original).
3. Restaurar os **dois volumes críticos**:
   - **`mongo_data`** (banco):
     ```bash
     docker compose up -d mongo
     docker exec -i autoflow2_mongo mongorestore --archive --gzip --drop \
       --nsInclude='wa_admin.*' < /caminho/backup/mongo/wa_admin.archive.gz
     ```
   - **`wa_auth`** (sessão do WhatsApp — evita re-escanear o QR):
     ```bash
     docker volume create whatsapp-autoflow_wa_auth
     docker run --rm -v whatsapp-autoflow_wa_auth:/dest -v /caminho/backup/volumes:/src \
       alpine sh -c "cd /dest && tar xzf /src/wa_auth.tar.gz"
     ```
4. Colocar o `.env` (do cofre) no lugar.
5. `docker compose up -d`.

## Notas da reconstrução

- Frontend: 9 telas refeitas a partir do bundle + contratos do backend.
- WA Gateway: base reconstruída em Baileys (contratos `/status` `/qr` `/contacts` `/send` `/send-media` + webhook). Para paridade exata, veja `backend/wa-gateway/LEIA-ANTES-DE-SUBIR.md`.
- Fixes de backend preservados: match de telefone pelos últimos 8 dígitos e contatos LID `uncertain`.
- Melhoria de UI: campo de número manual explícito no modal de Resposta Automática, sem remover a busca por nome.
