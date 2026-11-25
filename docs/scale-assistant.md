# Scale Assistant — extensão Chrome (Etapa 3)

Uma única extensão Manifest V3 com adaptadores por plataforma.

| Componente     | Arquivo                                 | Papel                                                                                           |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Service worker | `src/background.ts`                     | Abre o painel, recebe o token da web, guarda reuniões detectadas por aba, inicia/para a captura |
| Content script | `src/content.ts`                        | Lê **apenas metadados visíveis** (URL, título, nomes) — nunca áudio ou chat                     |
| Adaptadores    | `src/adapters/detect.ts`                | Google Meet, Zoom (cliente web), Microsoft Teams (web) — formatos de URL distintos              |
| Offscreen      | `src/offscreen.ts` + `audio-worklet.ts` | Captura áudio da aba e microfone, converte para PCM16 16 kHz estéreo e envia ao backend         |
| Painel lateral | `src/sidepanel/`                        | Preparação, consentimento, captura, transcrição ao vivo                                         |

## Fluxo

1. O usuário clica no ícone do Scale Assistant **na aba da reunião** (isso concede `activeTab`, exigido pelo Chrome para `tabCapture`).
2. Primeiro acesso: “Conectar com a plataforma” abre `/extensao/conectar` na web; a página emite um token
   próprio da extensão e o entrega via `externally_connectable` — aceito somente da origem da plataforma.
3. **Preparação**: cliente (opcional), playbook publicado, tipo e objetivo da reunião. Participantes visíveis
   são sugeridos automaticamente.
4. **Consentimento (LGPD)**: o profissional confirma como informou os participantes. Sem isso a API não emite ticket de captura.
5. **Captura**: a API emite um ticket de uso único (60 s); o offscreen abre o WebSocket
   `/v1/meetings/stream?ticket=…` e envia áudio em quadros de 100 ms.
   Canal 0 = microfone (profissional), canal 1 = áudio da reunião (cliente).
6. A API repassa ao Deepgram (chave **somente no servidor**), grava apenas os **segmentos finais** e devolve
   transcrição parcial/final ao painel. O áudio bruto não é armazenado.

## Limitações conhecidas (validadas)

- **Apps desktop** do Zoom e do Teams não são capturáveis por extensão. O painel avisa quando detecta a
  página de redirecionamento para o app e orienta a entrar pelo navegador.
- A captura precisa do clique do usuário no ícone da extensão (regra do Chrome para `tabCapture`).
- Na primeira captura, a permissão de microfone é pedida em `permission.html`.
- A identificação de participantes pelo DOM é de melhor esforço e pode mudar com atualizações das plataformas;
  o vínculo manual sempre funciona.
- Uma captura ativa por reunião por instância da API (para múltiplas instâncias, mover o controle para o Redis).

## Build e instalação

```bash
SCI_API_URL=https://api.SEU-DOMINIO SCI_WEB_URL=https://app.SEU-DOMINIO pnpm --filter @sci/extension build
```

Carregar `apps/extension/dist` em `chrome://extensions` (modo desenvolvedor) ou publicar como **não listada**
na Chrome Web Store. Configure na web `NEXT_PUBLIC_EXTENSION_IDS` com o ID da extensão publicada.

## Validação realizada

- Testes unitários: detecção por plataforma, títulos, conversão de áudio e montagem de quadros.
- API: ticket de uso único, consentimento obrigatório, quadros inválidos, provedor indisponível, isolamento.
- Deepgram: provedor real contra servidor WebSocket simulado (URL, `Authorization: Token`, multicanal, `CloseStream`).
- Chromium real com a extensão carregada: detecção no Meet (página simulada), autorização pela web,
  origem não autorizada sem acesso, preparação com cliente e playbook, consentimento, reunião na API.
- Pendente com recursos reais: captura de áudio de uma reunião de verdade (requer clique humano) e
  transcrição com `DEEPGRAM_API_KEY` válida.
