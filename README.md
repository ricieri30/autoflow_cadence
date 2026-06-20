<div align="center">

# AutoFlow **Cadence**

**Plataforma auto-hospedada de automação de WhatsApp** — respostas automáticas, agendamentos, esteira de onboarding, assinaturas e disparos recorrentes, com um console operacional de visual premium.

![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Node](https://img.shields.io/badge/Node-20-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-6-47A248?logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)

</div>

---

## Visão geral

O **AutoFlow Cadence** é um stack completo em Docker Compose que conecta um número de WhatsApp e automatiza a comunicação com seus contatos: dispara mensagens agendadas e recorrentes, responde automaticamente por palavra-chave, conduz fluxos de onboarding em etapas (a *esteira*) e acompanha vencimentos de assinatura.

É **totalmente independente** — banco de dados, fila, gateway, sessão de WhatsApp e dados são todos próprios. Não depende de nenhum serviço externo nem de outra instalação.

A interface adota a identidade **Cadence**: um console de operações em tema escuro, com acento jade, tipografia *Bricolage Grotesque* e elementos de sinal animados que reagem ao estado da conexão.

---

## Principais recursos

| Área | O que faz |
|------|-----------|
| **Visão Geral** | Painel com leituras clicáveis (automações, respostas auto, clientes, templates, esteira) e feeds de próximas automações e atividade recente. |
| **Clientes** | Cadastro de contatos com dados de assinatura, busca, e **Exportar/Importar** (`.json`). |
| **Esteira** | Onboarding em etapas (texto, **áudio**, imagem, vídeo, documento), mensagens semanais e renovação. |
| **Automações** | Disparos recorrentes via expressão *cron* (diário, semanal, mensal, intervalo). |
| **Respostas Auto** | Auto-resposta por palavra-chave, com janela de horário e correspondência tolerante. |
| **Agendamentos** | Mensagens únicas para data e hora específicas. |
| **Templates** | Mensagens reutilizáveis com a variável `{{nome}}`. |
| **Assinaturas** | Métricas de vencimento, textos de aviso (7d/1d/no dia) e inclusão de assinantes. |
| **Auditoria** | Registro das ações do sistema. |
| **WhatsApp** | Conexão por QR Code, status em tempo real, lista de contatos e desconexão de sessão. |

### Personalização `{{nome}}`
A variável `{{nome}}` é resolvida pelo **primeiro nome da sua agenda** (coleção de contatos), com tolerância ao 9º dígito brasileiro — e não pelo nome do perfil público do WhatsApp. Aplicada em todos os caminhos de envio.

### Confiabilidade do gateway
O gateway usa reconexão *single-flight* com *backoff* exponencial e limpeza de ouvintes (evita a "tempestade de reconexão" que derruba sessões), além de reenvio com retentativas no webhook (evita perder respostas automáticas por falha pontual).

---

## Arquitetura

```
                         ┌──────────────────────────────────────────────┐
   Navegador  ──:4050──▶ │  web (nginx + SPA React/Vite — tema Cadence)  │
                         │     /api/*  ──proxy──▶  api:3000              │
                         └───────────────┬──────────────────────────────┘
                                         │
        ┌────────────────────────────────┼─────────────────────────────┐
        ▼                                ▼                              ▼
┌───────────────┐              ┌───────────────────┐          ┌──────────────────┐
│ api (Express) │◀──webhook────│ wa-gateway        │          │ worker (BullMQ)  │
│ JWT · REST    │  /internal/  │ Baileys · QR/sessão│          │ disparos + delay │
└───────┬───────┘   message    └─────────┬─────────┘          └────────┬─────────┘
        │                                │ (volume: sessão)            │
        ▼                                ▼                             ▼
   ┌─────────┐                                                    ┌─────────┐
   │ MongoDB │◀───────────────── dados / fila de mensagens ──────▶│  Redis  │
   └─────────┘                                                    └─────────┘
```

| Serviço | Imagem / Base | Função | Porta |
|---------|---------------|--------|-------|
| `afcad_web` | nginx + React/Vite | SPA Cadence + proxy `/api` | **4050** → 80 |
| `afcad_api` | Node 20 / Express | API REST, autenticação JWT, regras de negócio | 3000 (interna) |
| `afcad_worker` | Node 20 / BullMQ | Processa a fila e envia com atraso anti-bloqueio | — |
| `afcad_gateway` | Node 20 / Baileys | Conexão com o WhatsApp, QR e sessão | 3333 (interna) |
| `afcad_mongo` | mongo:6 | Banco de dados | 27017 (interna) |
| `afcad_redis` | redis:7 | Fila de mensagens | 6379 (interna) |

Rede interna: `afcad-net` · Volumes persistentes: `afcad_mongo`, `afcad_redis`, `afcad_wa_auth` (sessão), `afcad_backups`.

---

## Deploy

### Opção A — Hostinger (Docker Manager · Compose URL)
1. Crie um repositório no GitHub e suba o conteúdo desta pasta **na raiz** (o `docker-compose.yml` junto de `backend/` e `web/` — não dentro de subpasta).
2. No hPanel: **Gerenciador Docker → Criar → Compose** e cole a URL *raw* do compose:
   ```
   https://github.com/<usuario>/<repo>/blob/main/docker-compose.yml
   ```
3. Nome do projeto: `autoflow_cadence` → **Implantar**. A primeira build leva alguns minutos.

### Opção B — VPS por terminal
```bash
git clone https://github.com/<usuario>/<repo>.git autoflow-cadence
cd autoflow-cadence
docker compose up -d --build
```

---

## Primeiro acesso

| | |
|---|---|
| **URL** | `http://SEU_IP:4050` |
| **Login inicial** | `admin@admin.com` / `admin123` |

1. Faça login e **troque a senha** na aba **Conta**.
2. Vá em **WhatsApp** e **escaneie o QR Code** para conectar.

> ⚠️ **Sessão de WhatsApp:** um número fica ativo em **uma sessão por vez**. Ao escanear com um número que já está em outra instância, a sessão migra para cá. Para testar sem afetar uma instalação existente, use um número dedicado.

---

## Configuração (variáveis de ambiente)

Os valores têm padrões embutidos no `docker-compose.yml`. Para produção, defina-os via `.env` (ou no painel) e **troque os segredos**.

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `JWT_SECRET` | *(placeholder)* | Segredo de assinatura dos tokens. **Troque** por valor aleatório (`openssl rand -hex 32`). |
| `ADMIN_EMAIL` | `admin@admin.com` | E-mail do admin inicial. |
| `ADMIN_PASSWORD` | `admin123` | Senha inicial (altere após o 1º login). |
| `MIN_MESSAGE_DELAY_MS` | `2000` | Atraso mínimo entre envios (anti-bloqueio). |
| `JITTER_MS` | `1000` | Variação aleatória somada ao atraso. |
| `NOTICE_7D` / `NOTICE_1D` / `NOTICE_TODAY` | *(textos)* | Avisos de vencimento de assinatura. |

---

## Estrutura do projeto

```
.
├── docker-compose.yml        # orquestração dos 6 serviços (independente)
├── backend/
│   ├── api/                  # API Express (REST + JWT + Mongo + BullMQ)
│   ├── worker/               # consumidor da fila (envios com atraso)
│   └── wa-gateway/           # gateway Baileys (sessão WhatsApp + webhook)
└── web/                      # SPA React/Vite (tema Cadence) + nginx
```

---

## Migração de dados

A base começa **vazia**. Para trazer dados de uma instalação anterior:
- **Por função:** use **Exportar** na origem e **Importar** aqui, aba por aba (Clientes, Templates, Respostas Auto, Agendamentos, Assinaturas).
- **Completa:** restauração do dump do MongoDB para o volume `afcad_mongo`.

---

## Roadmap

- [ ] Endpoint de **desconexão** de sessão na API + gateway (botão já existe na interface).
- [ ] **Áudio de verdade**: rota `/upload-media` na API + conversão `ffmpeg → opus (ptt)` no gateway.
- [ ] **HTTPS** com domínio (proxy reverso / certificado automático).

---

## Uso responsável

Esta ferramenta automatiza o envio de mensagens por uma sessão do WhatsApp. Use-a **apenas** com destinatários que consentiram em receber suas mensagens, respeitando os Termos de Serviço do WhatsApp e a legislação aplicável (incluindo a LGPD). Não a utilize para spam ou para se passar por terceiros.

---

## Stack técnica

Node.js 20 · Express · MongoDB 6 · Redis 7 · BullMQ · Baileys · React 18 · Vite · Tailwind CSS · nginx · Docker Compose.
