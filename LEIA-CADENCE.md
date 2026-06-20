# AutoFlow CADENCE — stack NOVA, COMPLETA e INDEPENDENTE

Esta é a estrutura **do zero**, no modelo do whatsapp-scheduler-pro_2026:
banco, fila, gateway, **sessão de WhatsApp** e dados são TODOS próprios.
**Não compartilha nada com o 4025** e **não herda os bugs dele.**

## O que já vem dentro
- Visual **Cadence** completo em TODAS as telas (sem semelhança com o antigo).
- `{{nome}}` resolvido pelo **1º nome da sua AGENDA** (em todos os envios).
- Opção **Áudio** + upload restaurada no onboarding da esteira.
- Dashboard com card **Respostas Auto** e cards/itens **clicáveis**.
- **Gateway corrigido**: fim da tempestade de reconexão (guarda single-flight +
  backoff + limpeza de ouvintes) e **retry no webhook** (auto-reply não se perde).

## Como subir (Hostinger Compose URL — igual aos outros)
1. Crie um repositório NOVO no GitHub (ex.: `autoflow-cadence`).
2. Suba o conteúdo DESTA pasta **na raiz** do repo (NÃO dentro de subpasta):
   - docker-compose.yml  +  backend/  +  web/  +  este LEIA  (tudo na raiz)
3. Hostinger → Docker Manager → Create → **Compose** → cole a URL RAW do
   docker-compose.yml:  .../<seu-repo>/blob/main/docker-compose.yml
4. Nome do projeto: `autoflow_cadence`. Deploy.

## Primeiro acesso
- Abre em:  http://2.25.145.110:4050
- Login:  admin@admin.com  /  admin123   (TROQUE depois, na aba Conta)
- Aba **WhatsApp** → escaneie o **QR novo**.

> ⚠️ SESSÃO PRÓPRIA: um número fica logado em UMA sessão por vez.
> Se escanear com seu número REAL, ele SAI do 4025 e vem pra cá.
> Para testar sem mexer no 4025, use **outro número** (chip de teste).

## Dados começam VAZIOS
- Migrar depois: por aba use **Exportar** no 4025 e **Importar** aqui,
  OU restauração de backup do Mongo (peça que eu te passo os comandos).

## Pendências conhecidas (próximos passos, já mapeados)
- **Desconectar** (botão já existe): falta a rota `/whatsapp/disconnect` na API
  + `/disconnect` no gateway. Como a sessão é própria, dá pra fazer e testar
  aqui SEM risco ao 4025.
- **Áudio de verdade**: o upload já manda pro `/upload-media`, mas a API ainda
  não tem essa rota e o gateway ainda não converte/encaminha áudio (ffmpeg+ptt).
- **HTTPS**: ainda sem domínio/cert (entra depois).
