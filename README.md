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

O app carregado pelo Vite começa em `index.html`, que contém a marcação da
interface e carrega `src/app/main.ts` antes do módulo de colaboração. A lógica
do editor, da execução e da comunicação HTTP fica em módulos TypeScript
separados; os estilos permanecem organizados em `src/styles/`.

```text
.
├── index.html                    # Marcação da interface e pontos de entrada
├── src/
│   ├── app/
│   │   ├── main.ts               # Inicialização e coordenação da interface
│   │   └── state.ts              # Estado em memória das sessões de execução
│   ├── editor/
│   │   ├── editor.ts             # Eventos e apresentação do textarea
│   │   ├── highlighting.ts       # Realce heurístico de sintaxe
│   │   └── cursor.ts             # Posição do cursor
│   ├── compiler/
│   │   ├── compiler.ts           # Contrato independente do backend
│   │   ├── compiler-service.ts   # Implementação remota atual via Judge0
│   │   └── types.ts              # Contratos da execução compartilhados
│   ├── collaboration.ts          # Firebase, Yjs, WebRTC e IndexedDB
│   ├── services/
│   │   └── api.ts                # Cliente HTTP de /api/run
│   ├── storage/
│   │   └── local-storage.ts      # Persistência local de código e nome
│   ├── env.d.ts                  # Tipos das variáveis de ambiente do Vite
│   └── styles/
│       ├── index.css             # Entrada que importa os módulos de estilo
│       ├── tokens.css            # Tokens e estilos globais
│       ├── layout.css            # Estrutura e painéis
│       ├── tabs.css              # Abas e presença
│       ├── editor.css            # Editor e console
│       ├── statusbar.css         # Barra de status
│       ├── utilities.css         # Classes utilitárias
│       └── responsive.css        # Ajustes responsivos
├── experiments/
│   └── monaco/                   # Experimento separado com Monaco e y-monaco
├── server/
│   ├── index.ts                  # API Express e signaling para desenvolvimento
│   └── judge0.ts                 # Validação e integração compartilhada com Judge0
├── api/
│   └── run.ts                    # Adaptador serverless da rota /api/run
├── public/
│   └── favicon.png               # Ícone servido pelo Vite
├── firebase.database.rules.json  # Regras do Realtime Database
├── .env.example                  # Modelo das variáveis de ambiente
├── vite.config.ts                # Vite e proxy local de /api
└── package.json                  # Dependências e comandos
```

`experiments/monaco/main.ts` e `experiments/monaco/style.css` são arquivos
experimentais: não são importados pela página principal. O build principal
inclui `src`, `server` e `api` no TypeScript, não o diretório `experiments`.
Para alterar a aplicação, comece pelo módulo correspondente em `src/app`,
`src/editor`, `src/compiler`, `src/services`, `src/storage` ou
`src/collaboration.ts`; a página HTML é a marcação e a composição dos pontos de
entrada.

### Responsabilidades e dependências entre arquivos

| Arquivo | Responsabilidade | Depende de / conversa com |
| --- | --- | --- |
| `index.html` | Marcações e pontos de entrada; carrega a aplicação e depois a colaboração. | `src/app/main.ts`, `src/collaboration.ts` e `src/styles/index.css`. |
| `src/app/main.ts`, `src/app/state.ts` | Inicialização da interface, identidade, modais, atalhos e estado da sessão de execução. | Editor, compiler, armazenamento local e os elementos do HTML. |
| `src/editor/*.ts` | Editor textarea, realce, sincronização visual, numeração de linhas e cursor. | Elementos do editor em `index.html`; `editor.ts` emite alterações para a aplicação. |
| `src/compiler/compiler.ts`, `src/compiler/compiler-service.ts`, `src/compiler/types.ts` | Contrato de execução e adaptação ao serviço remoto atual, sem expor o transporte Judge0 ao fluxo da interface. | `src/services/api.ts`; o contrato de entrada também é usado pelo backend. |
| `src/services/api.ts` | Envio tipado para `POST /api/run` e tratamento de respostas/erros HTTP. | `/api/run`, tipos em `src/compiler/types.ts`. |
| `src/storage/local-storage.ts` | Leitura e gravação do código e nome de exibição nas chaves locais existentes. | `localStorage`; não altera as chaves persistidas pela colaboração. |
| `src/styles/index.css` e `src/styles/*.css` | Entrada de estilos e módulos separados por responsabilidade visual: tokens, layout, abas, editor, status, utilitários e responsividade. | Importados pela página principal; os seletores precisam corresponder à marcação de `index.html`. |
| `src/collaboration.ts` | Identidade anônima, salas/presença, lista e ordem dos arquivos, sincronização Yjs, persistência IndexedDB, WebRTC, reconexão e diagnóstico. | Firebase Auth/Realtime Database, `yjs`, `y-indexeddb`, `y-webrtc` e os elementos/eventos de `index.html`. |
| `server/index.ts` | Servidor Express local: endpoint de execução, saúde e WebSocket `/signaling`. | `server/judge0.ts`, `ws` e o processo Node. |
| `server/judge0.ts` | Validação e preparação comum das submissões, instrumentação de entrada/tempo e chamada HTTP ao Judge0. | Consumido pelo Express e pela função serverless. |
| `api/run.ts` | Adaptador da rota serverless `POST /api/run`; impõe o limite de timeout dessa hospedagem. | Reutiliza `server/judge0.ts`; não mantém uma segunda implementação do protocolo Judge0. |
| `vite.config.ts` | Servidor de desenvolvimento e proxy de `/api` e WebSocket `/signaling` para o Express. | Backend local em `localhost:3001`. |
| `firebase.database.rules.json` | Regras de acesso aos nós `users` e `rooms` do Realtime Database. | Deve ser publicado no projeto Firebase utilizado pelo frontend. |
| `.env.example` | Nomes e exemplos das variáveis de configuração. | Copie para `.env.local` localmente; os segredos do backend ficam no ambiente do servidor. |
| `experiments/monaco/main.ts`, `experiments/monaco/style.css` | Experimento separado com Monaco e `y-monaco`. | Não participam da página e do fluxo principal atuais. |

`index.html` carrega `src/app/main.ts` antes de `src/collaboration.ts`. O editor
e a colaboração usam o mesmo `textarea#codeEditor` e observam os eventos
`input`: `src/editor/editor.ts` atualiza a apresentação e
`src/storage/local-storage.ts` salva o texto, enquanto a colaboração replica a
diferença incremental no Yjs. Ao aplicar uma alteração remota, a flag
`applyingRemoteChange` impede que o evento `input` gerado para atualizar o
`textarea` seja reenviado como uma nova edição local; o editor ainda atualiza o
realce, a posição do cursor e o salvamento local.

## Visão arquitetural

O sistema tem três planos independentes:

1. **Interface e estado transitório do navegador** (`src/app/` e `src/editor/`):
   código atualmente visível, seleção do cursor, saída do programa, entradas da
   sessão de execução, modais e notificações.
2. **Presença e metadados da sala** (Firebase): UID anônimo, nomes exibidos,
   dono, lista de membros e sala atual do dono. O Firebase não armazena nem
   transmite o texto dos arquivos.
3. **Conteúdo colaborativo** (Yjs): documentos em memória no navegador e
   persistência local em IndexedDB; o `y-webrtc` troca atualizações entre
   participantes. Um servidor WebSocket de signaling ajuda a encontrá-los, mas
   não é banco de dados nem relay do conteúdo.

O Judge0 é um quarto serviço externo, usado apenas quando alguém executa o
código. Ele não participa da colaboração ou do armazenamento dos arquivos.
Assim, uma falha no Judge0 não deve impedir abrir uma sala, e uma falha de
signaling/WebRTC não deve impedir editar o arquivo próprio localmente.

### Como seguir uma alteração de código

1. O usuário digita no `textarea#codeEditor`.
2. `src/editor/editor.ts` atualiza números de linha, realce e posição do cursor;
   `src/storage/local-storage.ts` salva em `console-source-code`.
3. `src/collaboration.ts` compara o texto anterior e o novo e transforma a
   diferença em operações incrementais no `Y.Text` ativo. Não acrescenta
   `#include`, flags ou texto de execução ao documento colaborativo.
4. Yjs aplica as operações ao documento e as envia pelo provider WebRTC. O
   IndexedDB persiste o documento no navegador para uso posterior/offline.
5. Os participantes recebem as operações, atualizam a aba correspondente e
   também persistem o estado local.

O realce da interface é uma camada de apresentação sobre o `textarea`; não é
um editor de texto separado nem o conteúdo enviado ao Yjs. O destaque é
heurístico, não um parser completo da linguagem C.

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
VITE_YJS_SIGNALING_URL=ws://localhost:5173/signaling
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

### Fluxo detalhado de compilação e execução

1. Ao pressionar **Run**, `src/app/main.ts` captura uma cópia do texto atual do
   editor, gera uma seed aleatória de 32 bits e começa uma sessão de execução.
   Alterar o editor depois disso não altera o código daquela sessão.
2. A aplicação chama o contrato `Compiler.run`; `Judge0Compiler` converte o
   pedido para a API atual de C e `src/services/api.ts` envia
   `sourceCode`, `languageId: 50`, as entradas acumuladas, `sessionSeed` e
   `sendEof` para `POST /api/run`. A rota local é atendida por
   `server/index.ts`; em produção, a plataforma encaminha a rota para
   `api/run.ts`.
3. Ambos os pontos de entrada chamam as mesmas funções de `server/judge0.ts`.
   O módulo valida os tipos e limites da solicitação, instrumenta o programa
   C, codifica o código e a entrada em Base64 e envia uma submissão ao Judge0
   com `wait=true`.
4. O resultado Base64 do Judge0 é decodificado no backend. A resposta JSON
   preserva campos como `stdout`, `stderr`, `compile_output` e `status`, e
   acrescenta `needsInput` para a interface saber se deve pedir outra entrada.
5. `Judge0Compiler` adapta essa resposta ao resultado independente do
   transporte; `src/app/main.ts` mostra saída, estado e tempo. Erros HTTP e
   erros de compilação/execução são apresentados como falha, sem misturá-los
   com o estado da colaboração.

`src/compiler/compiler.ts` define a fronteira consumida pela aplicação;
`src/compiler/compiler-service.ts` contém a implementação remota atual. A
interface cobre uma execução completa porque o endpoint atual compila e
executa em uma única solicitação. Não há compilador WebAssembly nem mudança no
backend nesta fase; uma implementação futura poderá substituir o adaptador sem
alterar o fluxo da interface.

`server/judge0.ts` acrescenta ao programa wrappers para leituras de entrada
(`scanf`, variantes de `fscanf`, `getchar`, `fgets`, `getline` e outras) e
funções de relógio. Os wrappers de entrada identificam quando uma leitura
atinge o fim dos dados recebidos e, quando ainda se espera mais entrada,
escrevem um marcador aleatório em `stderr`. O backend remove esse marcador e
retorna `needsInput: true`. Os wrappers de relógio usam a `sessionSeed` para
manter resultados dependentes de tempo estáveis entre reexecuções da mesma
sessão.

As opções de compilação ficam centralizadas em `getCompilerOptions()`. Hoje
incluem os `-Wl,--wrap=...` necessários à instrumentação e `-lm`, colocado
depois dessas opções de linkedição para habilitar `math.h` sem remover os
wrappers. O código submetido é instrumentado apenas no backend: o Yjs guarda o
texto exatamente como o usuário digitou.

#### Como funciona a entrada interativa

O Judge0 executa cada submissão como uma execução completa; o Console.Plus não
mantém um processo C parado esperando pelo teclado. Quando o programa pede mais
entrada:

- a interface guarda a linha digitada e a posição aproximada da saída que já
  havia sido produzida;
- reenvia o mesmo código, a mesma seed e todas as linhas acumuladas em `stdin`;
- o backend compila e executa o programa novamente desde o início;
- a interface recompõe a transcrição, intercalando as entradas digitadas com a
  saída devolvida.

O botão de EOF envia `sendEof: true`, instruindo a instrumentação a não sinalizar
uma nova solicitação de entrada quando o programa atingir o fim do fluxo. A
interface permite até 50 entradas por sessão e o backend limita o `stdin`
acumulado a 64 KiB. Por isso, programas com efeitos externos ou comportamento
não determinístico podem não ser adequados a esse modelo de reexecução.

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

No navegador, `src/services/api.ts` implementa o transporte HTTP e
`src/compiler/compiler-service.ts` adapta o protocolo atual ao contrato
`Compiler`. Os tipos compartilhados estão em `src/compiler/types.ts` e também
definem o `RunInput` validado no backend. O protocolo HTTP e os campos da API
permanecem inalterados.

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

### Diferença entre os handlers

`server/index.ts` cria o Express e o servidor HTTP local, expõe
`POST /api/run`, `GET /api/health` e o upgrade WebSocket `/signaling`. O
cancelamento da requisição do navegador aborta a chamada HTTP ao Judge0 quando
possível. `api/run.ts` é um adaptador serverless: valida o método, cria um
`AbortController`, aplica timeout máximo de 8 segundos e chama as mesmas
funções compartilhadas. A manutenção da validação, instrumentação e formato da
submissão deve ser feita em `server/judge0.ts`, não replicada nos handlers.

O campo `languageId` aceita um inteiro positivo, com padrão 50 (GNU C). O
frontend principal sempre envia 50. O backend também valida o limite de 100 KB
para o código-fonte, o limite de 64 KiB para entrada, a faixa da seed e o tipo
booleano de `sendEof`.

## Colaboração e publicação

### Modelo de dados e identificadores

Os identificadores do conteúdo compartilhado fazem parte do protocolo atual;
não os altere sem planejar uma migração compatível:

| Sistema | Identificador/caminho | Conteúdo |
| --- | --- | --- |
| Firebase Auth | UID do usuário anônimo | Identidade do navegador/perfil para presença; não é uma conta permanente. |
| Firebase Realtime Database | `rooms/<CODIGO>` | `ownerId`, `createdAt`, `maxMembers` e o objeto `members`. |
| Firebase Realtime Database | `rooms/<CODIGO>/members/<uid>` | Nome e `lastSeen` do participante. |
| Firebase Realtime Database | `users/<uid>/currentRoom` | Código da sala registrada pelo dono para poder retomá-la. |
| Yjs / WebRTC | `console-room-<CODIGO>` | Documento Yjs da sala. |
| Yjs | `console-file-personal:<uid>` | Texto do arquivo pessoal do participante dentro do documento. |
| IndexedDB (`y-indexeddb`) | `console-room-<CODIGO>` | Persistência local do documento Yjs; não é armazenamento central ou cópia de segurança. |
| `localStorage` | chaves `console-*` | Nome, código/UID/dono em cache, membros em cache, texto legado/local e marca de sala já compartilhada. |

O Firebase representa **quem está na sala**; o Yjs representa **o conteúdo dos
arquivos**. Um membro pode aparecer na presença antes que signaling, WebRTC e
Yjs tenham terminado a troca de estado. Da mesma forma, dados ainda existentes
no IndexedDB não significam que a pessoa esteja online.

Cada participante tem um `Y.Text` pessoal, identificado por seu UID. As abas
remotas permitem abrir e editar os arquivos dos outros membros quando há
conteúdo em cache ou quando o estado do provider permite a abertura; não há
bloqueio de edição por propriedade do arquivo. O proprietário é classificado à
esquerda; os demais são ordenados de forma determinística pelo UID, não pela
ordem em que entraram. Os nomes mostrados nas abas vêm da presença Firebase e
não são usados como identificador.

### Fluxo de abertura e encerramento de sala

1. Sem `?room=...`, o cliente cria um código aleatório de seis caracteres e
   marca temporariamente a URL como gerada. Com `?room=...`, usa o código
   validado da URL.
2. O cliente inicializa o documento Yjs, a persistência IndexedDB e o provider
   WebRTC para `console-room-<CODIGO>`. Isso é independente do overlay visual
   de carregamento e da conclusão da autenticação Firebase.
3. A autenticação anônima fornece o UID. Uma transação Firebase acrescenta o
   membro, aplica o limite de oito e mantém o dono existente enquanto ele ainda
   consta como membro; se o dono não estiver mais presente, o membro que entra
   pode se tornar o novo dono.
4. O cliente registra `onDisconnect(...).remove()` para remover sua presença
   quando o Firebase detectar desconexão e atualiza `lastSeen` a cada 15
   segundos enquanto a conexão está disponível.
5. Membros com heartbeat vencido há mais de 120 segundos podem ser removidos.
   Registros antigos sem `lastSeen` são avaliados pelo tempo desde que foram
   observados como legados naquele cliente.
6. Ao sair, o cliente remove apenas sua própria presença e navega para uma URL
   solo com outro código. O documento/cache daquela nova sessão fica separado;
   a saída não apaga automaticamente os documentos Yjs nem uma sala que ainda
   tenha outros participantes.

Quando uma nova sala é gerada, o código tenta consultar
`users/<uid>/currentRoom`. Se a sala anterior pertencer ao mesmo UID e estiver
sem outros membros, ela pode ser removida; se ainda houver outras pessoas, o
cliente retorna à sala ativa em vez de abandonar os participantes. O registro
`currentRoom` é feito para o dono. Como os UIDs são anônimos e específicos ao
perfil/navegador, o mecanismo não associa automaticamente dois dispositivos da
mesma pessoa.

### Por que a presença aparece, mas o arquivo não abre?

O Firebase cuida da autenticação e da lista de participantes; ele não transmite
o conteúdo dos arquivos. Os documentos Yjs ficam no navegador e suas mudanças
são trocadas entre os participantes por WebRTC. O servidor de sinalização
`y-webrtc` apenas ajuda os navegadores a se encontrarem e negocia a conexão
WebRTC; ele não armazena nem entrega o código do programa.

Por isso, ver alguém na lista do Firebase não prova que o canal WebRTC foi
estabelecido. O módulo distingue o arquivo próprio, que deve continuar editável
localmente, dos arquivos remotos, cuja disponibilidade depende de cache ou do
estado da colaboração. Falha de DNS, WebSocket bloqueado ou uma rede que impeça
a conexão WebRTC direta pode deixar a presença funcionando enquanto o arquivo
remoto não recebe as alterações.

O estado interno `providerSynced` é uma noção de saúde/possibilidade de
colaboração usada pela interface, não uma confirmação criptográfica de que
todos os documentos remotos já estão idênticos. Ele considera estados do
provider, peers e conexões de signaling. `provider.room.synced` é o estado
reportado pelo y-webrtc para sua sincronização. Ao depurar, compare os dois
estados com awareness e peers, e teste se uma edição real atravessa os dois
navegadores; uma conexão de signaling, sozinha, não prova que o transporte
WebRTC ou a sincronização do documento terminou.

Hosts públicos antigos de signaling foram marcados como obsoletos na
configuração do cliente após falhas observadas. Por isso, este projeto inclui o
endpoint WebSocket `/signaling` no mesmo backend Express usado pela API
local/Render. Ele apenas encaminha mensagens efêmeras de negociação; não
persiste nem substitui o conteúdo Yjs. A URL configurada pelo projeto é a fonte
de verdade; não dependa de hosts públicos padrão do `y-webrtc`.

No desenvolvimento, `VITE_YJS_SIGNALING_URL=ws://localhost:5173/signaling` usa
o proxy WebSocket do Vite para o backend em `localhost:3001`. Na produção, use
o domínio do backend Render já existente, por exemplo
`wss://SEU-BACKEND.onrender.com/signaling`. Configure esse valor como
`VITE_YJS_SIGNALING_URL` no ambiente de build do frontend na Vercel e faça um
novo deploy. Não é necessário criar outro serviço; o backend atual precisa ser
redeployado com o endpoint incluído.

Para abrir o painel de diagnóstico, acrescente `?debug=1` à URL (ou
`&debug=1` se ela já tiver parâmetros). Ele mostra cada URL de signaling e seu
estado conectado/desconectado, `provider.connected`, `provider.room.synced`,
quantidade de conexões WebRTC, estados de awareness, código da sala, UID
anônimo, quantidade de membros Firebase e um log com horário de autenticação,
entrada na sala, estado do provider, peers, timeout e tentativas de
reconexão. O painel e a atualização periódica só são criados quando
`debug=1` está presente.

Se, após 10 segundos com outros participantes, o provider continuar sem um
estado de conexão considerado saudável, o app informa
**“Sincronizando... a conexão está demorando”** e oferece **“Tentar novamente”**.
A ação recria o provider da mesma sala; o documento Yjs e a persistência local
são preservados. O arquivo próprio permanece editável enquanto a conexão é
restabelecida. Se o WebSocket de signaling não conectar, o retry sozinho não
resolve: confira a URL configurada e se o backend está acessível.

O provider configura os servidores STUN públicos `stun:stun.l.google.com:19302`
e `stun:stun1.l.google.com:19302` para ajudar na negociação de conexões diretas.
STUN não é um relay: algumas redes restritivas ainda podem exigir TURN.

O overlay de loading cobre a interface, mas não condiciona a inicialização do
Yjs/WebRTC. A colaboração começa independentemente da exibição ou remoção dessa
tela.

### O que o endpoint de signaling faz

O upgrade WebSocket de `/signaling` é implementado pelo servidor HTTP de
`server/index.ts`. O relay mantém em memória um mapa de tópicos para as
conexões WebSocket inscritas e encaminha mensagens `publish` aos inscritos do
tópico. Também processa `subscribe`, `unsubscribe` e `ping`; configura ping /
pong para detectar conexões mortas e remove as inscrições quando o socket fecha.
O payload máximo aceito é 64 KiB.

Esse serviço só encaminha mensagens de negociação do `y-webrtc`: não guarda
histórico, código-fonte, lista Firebase de membros nem mensagens para clientes
que entrarem depois. Reinício do backend elimina as inscrições; os clientes
precisam reconectar e renegociar. Como o estado é em memória, a implantação
deve encaminhar conexões da mesma sala para instâncias que consigam se enxergar.
Se o Render executar várias instâncias independentes sem um relay compartilhado
ou afinidade adequada, cada instância terá apenas seus próprios sockets.

Em desenvolvimento:

```text
navegador -> Vite :5173 -> proxy WebSocket /signaling -> Express :3001
```

Em produção:

```text
navegador -> VITE_YJS_SIGNALING_URL (wss://...) -> backend Render /signaling
```

O valor `VITE_YJS_SIGNALING_URL` é embutido no bundle quando o Vite constrói o
frontend. Mudar a variável na Vercel exige novo build/deploy. A URL é
configuração pública, não segredo. Atualmente o cliente usa a URL configurada;
em desenvolvimento, se ela estiver ausente ou for considerada obsoleta, usa o
proxy local. Em produção, sem uma URL válida, não há fallback para um host
público: o app avisa que a sinalização precisa ser configurada.

O endpoint relay não autentica usuários, não aplica rate limit e não persiste
dados. O acesso às salas do Firebase é uma autorização separada, com regras em
`firebase.database.rules.json`. Antes de expor a execução e o signaling a
tráfego público, avalie limites de abuso, custos do Judge0 e proteção operacional
apropriada.

### Ciclo de vida Yjs e estados de sincronização

- Por carregamento de página há um `Y.Doc`, um `IndexeddbPersistence` e um
  `WebrtcProvider` para o código da sala.
- O módulo publica as referências em `window.__consolePlusCollaboration`. Se o
  módulo for inicializado novamente na mesma página, encerra os recursos
  anteriores para evitar providers/documentos duplicados.
- O botão **Tentar novamente** destrói e recria o provider, mas mantém o mesmo
  `Y.Doc` e persistência. A reconexão em `online` e ao tornar a aba visível
  tenta reconectar o provider existente se detectar falta de conexão.
- `localPersistence.whenSynced` informa que o cache IndexedDB carregou; isso é
  diferente de `provider.room.synced`, que é o estado de sincronização do
  y-webrtc, e diferente da presença Firebase.
- O awareness não guarda o código. É usado, entre outras coisas, para indicar
  qual arquivo o participante está editando (`consolePlusTyping`).
- O timeout de 10 segundos é um aviso de conexão quando há outro membro; não é
  timeout de autenticação Firebase nem limite de execução do Judge0. A
  colaboração segue em background, sem depender da tela de loading.

Ao alterar esse fluxo, preserve a distinção entre o texto local editável e os
documentos remotos. Atualizações remotas do Y.Text alteram o `textarea`; a flag
`applyingRemoteChange` evita que esse evento sintético seja retransmitido como
uma nova edição. O `Y.Text` deve conter somente o código digitado, sem
instrumentação do Judge0.

### É obrigatório hospedar outro serviço?

Não. O endpoint `/signaling` roda no mesmo processo HTTP do backend Express
existente e pode ser publicado no serviço Render que já hospeda a API. Vercel
continua hospedando o frontend e as funções de execução; configure o endereço
WebSocket do Render em `VITE_YJS_SIGNALING_URL` e gere um novo deploy do
frontend. O comando `npm run signaling` ainda pode iniciar o servidor
independente para testes, mas não é necessário para esse arranjo.

Por fim, signaling e transporte WebRTC não garantem que toda rede permita uma
conexão direta entre navegadores. Redes restritivas podem exigir um servidor
TURN para retransmitir o tráfego WebRTC, que é uma configuração separada do
signaling. Primeiro confirme que o WebSocket de signaling conecta; se isso
ocorrer, mas o WebRTC ainda falhar entre algumas redes, investigue TURN.

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
código. Um novo participante pode editar seu próprio arquivo local enquanto
aguarda a sincronização; arquivos dos demais ficam indisponíveis até o WebRTC
sincronizar. Quando outro participante entra, o app mostra o estado de sala
online após a sincronização. A lista e o botão de saída permanecem visíveis
depois que a sala já foi compartilhada, mesmo que os outros participantes
saiam; o contador então mostra `1/8`. Ao sair, o usuário remove somente a
própria presença e abre uma sessão solo com documento Yjs e cache IndexedDB
separados.

Para publicar o app, configure as variáveis `VITE_FIREBASE_*` e
`VITE_YJS_SIGNALING_URL` (URL `wss://.../signaling` do backend Render) no
ambiente de build do frontend. Em uma hospedagem como Vercel, configure também
`JUDGE0_URL`, `JUDGE0_TIMEOUT_MS` e, se
necessário, `JUDGE0_AUTH_TOKEN` como variáveis exclusivas do servidor. A
função serverless de execução é descoberta a partir de `api/run.ts`.

O conteúdo das variáveis `VITE_*` é incorporado ao JavaScript do navegador e
não deve conter segredos. Publique as regras do Firebase e proteja os serviços
de execução com limites apropriados.

## Desenvolvimento e manutenção

### Verificação local

```sh
npm run build
```

Esse comando executa `tsc -b` e depois `vite build`, gerando os arquivos
estáticos em `dist/`. Não existe atualmente um comando de testes automatizados
no `package.json`; para colaboração, complemente o build com testes manuais em
dois contextos de navegador e teste também reconexão. `dist/` é artefato gerado,
não o lugar para corrigir o código-fonte.

### Roteiro manual de regressão

1. Abra uma sala em um perfil e entre com o código em outro navegador/perfil.
2. Confirme presença, abertura das abas e edição de texto nos dois sentidos.
   Edite o arquivo pessoal de cada participante, não apenas o do dono.
3. Recarregue um dos lados durante a edição e confira se a presença não duplica e
   se as abas/alterações reaparecem após o IndexedDB e o provider conectarem.
4. Oculte uma aba por um período e volte; depois teste desligar e restaurar a
   rede. A página deve tentar reconectar sem apagar o documento local.
5. Com `?debug=1`, compare `provider.connected`, `provider.synced`, conexões de
   signaling, peers WebRTC, awareness, membros Firebase e eventos nos dois
   lados. Não conclua que os documentos sincronizaram apenas porque signaling
   está conectado: confirme uma edição real.
6. Desconecte o signaling no DevTools. Se houver outros membros e a conexão
   não se recuperar, deve aparecer o aviso após o timeout e o botão **Tentar
   novamente**.
7. Execute um programa simples, um usando `math.h` e um que leia com `scanf`.
   Confira também múltiplas entradas e EOF; isso valida uma área independente
   da sincronização colaborativa.

### Como investigar por sintoma

| Sintoma | Primeiro lugar para olhar | Interpretação |
| --- | --- | --- |
| Lista de membros vazia ou contador errado | Auth, `.info/connected`, `rooms/<CODIGO>/members`, regras Firebase e heartbeat. | É o plano de presença; ainda não informa o estado do Yjs. |
| Usuário aparece, mas arquivo não sincroniza | `?debug=1`: URL/estado do signaling, `provider.connected`, `provider.synced`, peers e awareness; depois logs do backend Render. | Pode haver presença Firebase sem conexão de signaling/WebRTC. Uma conexão de signaling não prova entrega de conteúdo. |
| Código some após recarregar | `console-file-personal:<uid>`, IndexedDB `console-room-<CODIGO>`, UID e URL da sala. | Verifique se o navegador/perfil é o mesmo e se o cache do site foi apagado. |
| Aba própria vazia ou loading persistente | `localPersistence.whenSynced`, estado `personalFileState`, `pendingLocalDraft` e erros de `authenticateAndJoin()`. | O arquivo próprio deve continuar local; verifique se o cache, a autenticação e o fallback foram concluídos. |
| Outra pessoa aparece duplicada | UID anônimo, entradas de membros Firebase e evento `onDisconnect`. | Perfis e dispositivos diferentes recebem UIDs distintos; dados antigos podem expirar pelo heartbeat. |
| `math.h` compila localmente, mas não no app | Payload de `POST /api/run`, instância Judge0 e `getCompilerOptions()` em `server/judge0.ts`. | A opção `-lm` pertence à chamada remota do Judge0, não ao Vite ou a uma configuração local do editor. |
| `scanf` não pede outra entrada | `stdin`, `sendEof`, saída/estado Judge0 e wrappers em `server/judge0.ts`. | A interface reexecuta o programa com as entradas acumuladas; não existe processo persistente aguardando input. |

### Decisões de implementação que vale preservar

- **Um documento por sala, um texto por arquivo pessoal:** mantém os arquivos
  independentes sem misturar presença Firebase com conteúdo.
- **Presença no Firebase, conteúdo no Yjs:** permite atualizar nomes e membros
  sem armazenar código no banco de presença, mas implica que a conexão de dados
  depende de WebRTC e signaling.
- **IndexedDB local:** permite reabrir conteúdo no mesmo navegador, mas não é
  uma cópia central nem substitui sincronização entre dispositivos.
- **Diff incremental no Y.Text:** altera apenas o trecho diferente do editor em
  vez de substituir o documento inteiro a cada tecla; isso reduz conflitos
  artificiais e preserva o modelo colaborativo.
- **Snapshot de código por sessão de execução:** uma execução não muda se o
  usuário editar o documento enquanto o Judge0 está trabalhando.
- **Judge0 compartilhado pelos handlers:** Express e serverless passam pela
  mesma validação e instrumentação, reduzindo divergência entre ambientes.
- **Instrumentação limitada ao backend:** o texto sincronizado permanece
  exatamente o que o usuário digitou; os wrappers só existem na submissão
  executada.
- **Loading é visual:** não usar a remoção do overlay como condição para criar
  documento, provider, listeners ou presença.
- **STUN não é TURN:** STUN ajuda na descoberta de rota direta, mas não resolve
  todas as redes que bloqueiam conexões peer-to-peer. Adicionar TURN é uma
  decisão de infraestrutura separada.

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
