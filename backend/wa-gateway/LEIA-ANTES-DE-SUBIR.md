# wa-gateway — base operacional reconstruída

Este gateway foi **reconstruído do zero** (Baileys) para casar com os contratos
que API e Worker já consomem: `/status`, `/qr`, `/contacts`, `/send`,
`/send-media` e o webhook de mensagens recebidas. Ele builda e sobe; a conexão
real gera o QR na primeira execução.

Fixes preservados: contatos LID não resolvidos saem com `uncertain:true` e há
deduplicação por nome no `/contacts`.

## Opcional — paridade exata com a produção

Se você quiser bater 100% com o gateway que rodava antes (mesma versão de
Baileys, mesmos detalhes de envio de mídia), pode substituir esta pasta pela
fonte original do servidor:

```bash
scp -r /root/docker/whatsapp_autoflow_claude/wa-gateway/* \
       SEU_USUARIO@SUA_VPS:/caminho/do/repo/backend/wa-gateway/
```

Recomendado validar primeiro na stack isolada antes de promover.
