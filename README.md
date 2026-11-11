# Console.Plus

Editor web colaborativo para escrever, compilar e executar programas em C.
O app oferece um editor com destaque de sintaxe, entrada para programas que
usam `scanf`, compartilhamento de salas e execução remota pelo Judge0.

## Funcionalidades

- Edição de C em um editor baseado em `textarea`, com destaque de sintaxe,
  numeração de linhas e posição do cursor.
- Salvamento do código e do nome de exibição no armazenamento local do
  navegador.
- Salas colaborativas com arquivos pessoais, presença e até oito participantes.
- Sincronização do código por Yjs/WebRTC e cache local em IndexedDB.
- Execução de C pelo Judge0, incluindo entrada interativa: cada resposta
  reexecuta o programa com as entradas acumuladas.
- Atalhos: `Ctrl+Enter`/`Cmd+Enter` para executar, `Esc` para interromper e
  `Ctrl+Shift+C`/`Cmd+Shift+C` para copiar todo o código.

## Como o projeto está organizado

O app carregado pelo Vite começa em `index.html`. A interface e a lógica do
editor e da execução estão no próprio HTML; a integração de colaboração é
carregada por `src/collaboration.ts`.

```text
.
├── index.html                    # Interface principal e lógica do editor
├── src/
│   ├── collaboration.ts          # Firebase, Yjs, WebRTC e IndexedDB
│   ├── main.ts                   # Protótipo alternativo com Monaco
│   └── style.css                 # Estilos do protótipo Monaco
├── server/
│   ├── index.ts                  # API Express para desenvolvimento local
│   └── judge0.ts                 # Validação e integração compartilhada com Judge0
├── api/
│   └── run.ts                    # Função serverless da rota /api/run
├── firebase.database.rules.json  # Regras do Realtime Database
├── .env.example                  # Modelo das variáveis de ambiente
├── vite.config.ts                # Vite e proxy local de /api
└── package.json                  # Dependências e comandos
```

`src/main.ts` é uma implementação alternativa e não é importada pela página
principal. O protótipo `app.js`/`styles.css` também não é usado pelo fluxo
principal.

## Requisitos

- Node.js 18 ou superior e npm.
- Um projeto Firebase com Authentication anônima e Realtime Database para
  colaboração.
- Acesso à internet e uma instância Judge0 acessível para executar C.

## Configuração local

Instale as dependências e crie o arquivo local de configuração do Vite:

```sh
npm install
cp .env.example .env.local
```

Preencha em `.env.local` as variáveis públicas do aplicativo Web do Firebase:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_YJS_SIGNALING_URL=wss://y-webrtc-eu.fly.dev
```

No Firebase:

1. Habilite o provedor **Anonymous** em Authentication.
2. Crie um Realtime Database.
3. Publique as regras de [firebase.database.rules.json](./firebase.database.rules.json).

As regras também permitem que cada UID anônimo leia e atualize seu próprio
registro `users/<uid>/currentRoom` e que o dono remova uma sala vazia. Se as
regras já estavam publicadas, publique novamente o arquivo atualizado.

Sem as variáveis Firebase, a interface carrega, mas a sala e o arquivo pessoal
não ficam disponíveis. O limite de oito participantes é verificado pelo
aplicativo cliente; as regras atuais do banco não impõem esse limite contra
clientes modificados.

O Vite carrega as variáveis `VITE_*` de `.env.local`. As configurações do
backend devem ser definidas no ambiente do processo que inicia o servidor (ou
nas configurações do serviço de hospedagem):

```sh
JUDGE0_URL=https://ce.judge0.com \
JUDGE0_TIMEOUT_MS=30000 \
npm run dev:all
```

`JUDGE0_AUTH_TOKEN` é opcional e só deve ser configurada se a instância Judge0
exigir autenticação. Não use o prefixo `VITE_` para esse segredo.

Inicie frontend e backend juntos:

```sh
npm run dev:all
```

Abra <http://localhost:5173>. O Vite encaminha `/api` ao Express em
`http://localhost:3001`. Também é possível iniciar os processos em terminais
separados:

Terminal 1:

```sh
npm run server
```

Terminal 2:

```sh
npm run dev
```

Se alterar a porta do backend com `PORT`, atualize também o destino do proxy em
`vite.config.ts`.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento Vite |
| `npm run server` | Inicia a API Express local |
| `npm run dev:all` | Inicia Vite e Express em conjunto |
| `npm run build` | Executa a verificação TypeScript e cria a build Vite em `dist/` |
| `npm run signaling` | Inicia um servidor de sinalização WebSocket `y-webrtc` |

## API de execução

O endpoint `POST /api/run` recebe JSON:

```json
{
  "sourceCode": "#include <stdio.h>\nint main(void) { puts(\"Oi\"); }",
  "languageId": 50,
  "stdin": "",
  "sessionSeed": 12345,
  "sendEof": false
}
```

`languageId` usa `50` (GNU C no Judge0) como padrão. `stdin` pode conter as
entradas acumuladas; envie a mesma `sessionSeed` ao reexecutar uma sessão.
Defina `sendEof: true` para encerrar as leituras com EOF. Respostas bem-sucedidas
incluem `needsInput`, indicando que o programa aguarda mais entrada.

O backend valida o código (máximo de 100 KB), a entrada (máximo de 64 KB), a
seed e os demais parâmetros antes de enviar a submissão codificada em Base64
ao Judge0. A instrumentação de entrada detecta leituras no fim do `stdin`; ela
não mantém um processo C aberto entre respostas. O limite de entradas da
interface é 50 por sessão.

No desenvolvimento, `server/index.ts` também expõe `GET /api/health`. Para
produção, `api/run.ts` publica `POST /api/run` como função serverless, por
exemplo na Vercel. O handler serverless limita o timeout do Judge0 a no máximo
8 segundos; o Express local usa 30 segundos por padrão.

Configurações do backend:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3001` | Porta do Express local |
| `JUDGE0_URL` | `https://ce.judge0.com` | URL da instância Judge0 |
| `JUDGE0_TIMEOUT_MS` | `30000` no Express; `8000` na função serverless | Limite de espera |
| `JUDGE0_AUTH_TOKEN` | vazio | Token opcional para a instância Judge0 |

## Colaboração e publicação

O Firebase fornece autenticação anônima e presença da sala. O conteúdo dos
arquivos é sincronizado por Yjs/WebRTC, não pelo Firebase, e também é mantido
localmente em IndexedDB para recuperação no mesmo navegador. A sinalização
WebRTC usa `VITE_YJS_SIGNALING_URL`, que por padrão aponta para
`wss://y-webrtc-eu.fly.dev` e `wss://y-webrtc-us.fly.dev`. O endereço antigo
`wss://signaling.yjs.dev` é migrado automaticamente para esses servidores. Um
servidor próprio pode ser iniciado com `npm run signaling` em uma hospedagem
que mantenha WebSockets ativos.

O app registra a sala atual pelo UID anônimo do Firebase. Ao abrir o app sem
código de sala, ele retoma a sala existente desse UID; se a sala anterior
estiver vazia, ela é removida antes da nova criação. Salas com outros membros
continuam ativas e são retomadas, não apagadas. A presença é atualizada a cada
15 segundos e membros sem atualização por 120 segundos são considerados
inativos e removidos. Como a autenticação é anônima, esse limite vale por
identidade Firebase do navegador/perfil, não identifica a mesma pessoa entre
dispositivos. Salas antigas sem registro de sala atual não podem ser localizadas
automaticamente; o dono precisa reabri-las uma vez para registrar a sala, ou
removê-las manualmente no Firebase.

Ao abrir uma sala sem outros participantes, o editor funciona como uma sessão
solo: o arquivo fica salvo localmente e a sala aguarda alguém entrar pelo
código. Só quando outro participante entra e a conexão WebRTC sincroniza o app
mostra o estado de sala online. O botão de saída aparece quando há outro
participante; ao usá-lo, o usuário sai da presença e abre uma sessão solo com
documento Yjs e cache IndexedDB separados.

Para publicar o app, configure as variáveis `VITE_FIREBASE_*` e
`VITE_YJS_SIGNALING_URL` no ambiente de build do frontend. Em uma hospedagem
como Vercel, configure também `JUDGE0_URL`, `JUDGE0_TIMEOUT_MS` e, se
necessário, `JUDGE0_AUTH_TOKEN` como variáveis exclusivas do servidor. A
função serverless de execução é descoberta a partir de `api/run.ts`.

O conteúdo das variáveis `VITE_*` é incorporado ao JavaScript do navegador e
não deve conter segredos. Publique as regras do Firebase e proteja os serviços
de execução com limites apropriados.

## Limitações conhecidas

- Não há contas permanentes; os participantes entram anonimamente.
- O código da sala é o convite. O limite de oito membros é aplicado no cliente,
  não como uma garantia de segurança no servidor.
- O código não tem persistência central: o cache IndexedDB é local ao navegador
  e pode ser apagado pelos dados do site.
- A entrada interativa repete a execução inteira no Judge0 para cada resposta.
- **Stop** cancela a requisição HTTP do navegador, mas não garante que uma
  execução já recebida pelo Judge0 seja encerrada.
- O app principal não possui chat, histórico de execuções ou seleção de
  linguagem; o destaque de sintaxe é baseado em regras simples.
- A API de execução não inclui autenticação nem rate limiting. Antes de expô-la
  publicamente, configure proteção contra abuso e limites adequados no serviço
  de execução.
