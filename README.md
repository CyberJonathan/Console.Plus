# Console — editor online de C

O Console é uma aplicação web experimental para escrever, compilar e executar
programas em C no navegador. A interface tem um visual escuro e minimalista,
com editor de código, destaque de sintaxe, numeração de linhas, entrada para
`scanf`, área de resultado e ações de copiar e executar.

O projeto também contém uma implementação alternativa baseada em Monaco, Yjs e
WebRTC em [src/main.ts](./src/main.ts). A página usada atualmente pelo Vite é
[index.html](./index.html), que carrega
[src/collaboration.ts](./src/collaboration.ts) para a colaboração do editor
principal.

## Índice

- [Visão geral da arquitetura](#visão-geral-da-arquitetura)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Fluxo completo da aplicação](#fluxo-completo-da-aplicação)
- [Como o editor funciona](#como-o-editor-funciona)
- [Como a execução de C funciona](#como-a-execução-de-c-funciona)
- [Como a colaboração funciona](#como-a-colaboração-funciona)
- [Como configurar o Firebase](#como-configurar-o-firebase)
- [Backend e API](#backend-e-api)
- [Instalação e execução](#instalação-e-execução)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts disponíveis](#scripts-disponíveis)
- [Limitações atuais](#limitações-atuais)
- [Segurança e produção](#segurança-e-produção)
- [Manutenção e próximos passos](#manutenção-e-próximos-passos)

## Visão geral da arquitetura

O sistema é dividido em três partes:

```text
Navegador
  └── index.html
        ├── editor e interface visual
        ├── destaque de sintaxe
        ├── estado local do usuário/código
        └── POST /api/run
                    │
                    ▼
Backend Express
  └── server/index.ts
        ├── valida o JSON recebido
        ├── codifica código e entrada em Base64
        ├── envia uma submissão ao Judge0
        ├── decodifica o resultado
        └── devolve JSON ao navegador
                    │
                    ▼
Judge0
  └── compila e executa o C em ambiente remoto
```

Durante o desenvolvimento, existem dois servidores:

| Servidor | Porta padrão | Responsabilidade |
| --- | ---: | --- |
| Vite | `5173` | Entregar a página e recarregar alterações durante o desenvolvimento |
| Express | `3001` | Receber o código e conversar com o Judge0 |

O Vite encaminha todas as requisições começando com `/api` para o Express,
configuração feita em [vite.config.ts](./vite.config.ts). Assim, o navegador
sempre usa uma URL relativa, como `/api/run`, sem precisar conhecer
diretamente a porta do backend.

## Estrutura do projeto

```text
.
├── index.html          # Página atual: HTML, CSS e JavaScript da interface
├── server/
│   └── index.ts        # API Express e integração com o Judge0
├── src/
│   ├── main.ts         # Implementação alternativa com Monaco + Yjs/WebRTC
│   ├── style.css       # Estilos da implementação alternativa
│   └── env.d.ts        # Declarações de tipos para o frontend
├── vite.config.ts      # Porta do Vite e proxy /api
├── tsconfig.json       # Configuração principal do TypeScript
├── package.json        # Dependências e scripts
├── package-lock.json   # Versões exatas das dependências instaladas
└── dist/               # Saída gerada pelo build do Vite
```

### Qual arquivo é executado?

O comando `npm run dev` usa o `index.html` como entrada do Vite. O script da
página está no final do próprio HTML, dentro de uma tag `<script>`.

O arquivo `src/main.ts` não é importado pelo `index.html` atual. Ele representa
uma versão alternativa do frontend, com Monaco Editor e colaboração por Yjs.
Se essa versão for escolhida no futuro, será necessário conectá-la a uma
entrada do Vite, por exemplo com `<script type="module" src="/src/main.ts">`,
e alinhar os IDs e elementos HTML esperados pelo TypeScript.

## Fluxo completo da aplicação

### 1. A página é carregada

O navegador abre `index.html`. O HTML cria:

- barra superior com usuário e ações;
- aba `main.c`;
- editor baseado em `<textarea>`;
- elemento `<pre>` usado como camada visual de destaque;
- numeração de linhas;
- painel de resultado;
- formulário de entrada para programas que usam `scanf`;
- modal para alterar o nome exibido;
- toast para mensagens curtas.

Ao final do documento, o JavaScript obtém esses elementos com
`document.querySelector` e registra os eventos de teclado, clique, entrada e
envio de formulários.

### 2. O código inicial é carregado

O código padrão é:

```c
#include <stdio.h>

int main() {
  printf("Olá, mundo!\n");
  return 0;
}
```

Depois disso, a aplicação tenta ler `console-source-code` do `localStorage`.
Se existir um valor salvo, ele substitui o código inicial. A cada alteração no
editor, o novo conteúdo é salvo novamente no navegador.

Isso é apenas persistência local: o código salvo não é enviado para um banco de
dados e não fica disponível automaticamente em outro navegador.

### 3. O usuário edita o código

O usuário escreve no `textarea` `#codeEditor`. A cada evento de `input`:

1. o código é salvo no `localStorage`;
2. os números de linha são recalculados;
3. o destaque de sintaxe é reconstruído;
4. o conteúdo visual da camada de destaque é atualizado.

O editor também trata a tecla `Tab` manualmente, inserindo dois espaços em vez
de mudar o foco para o próximo controle.

Como a camada colorida e o `textarea` ficam sobrepostos, o texto real continua
editável no textarea, enquanto o `<pre id="codeHighlight">` mostra uma versão
colorida por baixo. O texto do textarea é transparente, mas o cursor continua
visível.

### 4. O usuário executa

O botão `Run` e o atalho `Ctrl+Enter` iniciam a execução. O frontend:

1. verifica se o código contém `scanf`;
2. se contiver, mostra o formulário de entrada;
3. caso contrário, envia imediatamente o código para `/api/run`;
4. mostra o estado `Executando...`;
5. mede o tempo total da requisição;
6. escolhe a saída apropriada;
7. pinta o resultado como sucesso ou erro.

O botão `Stop` atualmente interrompe o fluxo visual local: fecha o formulário
de entrada, atualiza o status e mostra uma mensagem. Ele não cancela uma
requisição HTTP que já foi enviada ao backend nem interrompe um processo que já
esteja rodando no Judge0.

## Como o editor funciona

### Numeração de linhas e posição do cursor

`updateLineNumbers()` divide o código por `\n`, cria uma sequência de números e
coloca essa sequência em `#lineNumbers`.

O cursor é calculado com `selectionStart`. O texto antes do cursor é dividido
em linhas; o tamanho da última linha determina a coluna. O status é exibido no
formato:

```text
Ln 3, Col 12
```

### Destaque de sintaxe

`highlightCode()` usa uma expressão regular para reconhecer tokens de C, como:

- `#include`;
- comentários `//` e `/* ... */`;
- strings;
- números;
- palavras-chave como `int`, `return`, `if` e `while`;
- funções `printf` e `scanf`;
- o identificador `main`.

Antes de inserir qualquer código no HTML, a função `escapeHtml()` transforma
caracteres como `<`, `>` e `&` em entidades HTML. Isso impede que o código
digitado seja interpretado como marcação dentro da camada de destaque.

O destaque é intencionalmente simples. Ele não é um parser completo da
linguagem C e pode não colorir corretamente macros complexas, strings
multilinha ou construções avançadas.

### Nome do usuário

O botão da identidade abre um modal. Ao salvar:

1. espaços repetidos são normalizados;
2. o nome é limitado a 32 caracteres;
3. as iniciais são calculadas;
4. nome e iniciais são atualizados na interface;
5. o nome é salvo como `console-user-name` no `localStorage`.

Esse nome é local e não representa autenticação. Atualmente ele não é enviado
ao backend.

### Copiar código

O botão de copiar usa:

```js
navigator.clipboard.writeText(editor.value)
```

O navegador pode bloquear essa API quando a página não está em um contexto
seguro ou quando a ação não foi iniciada por uma interação do usuário.

## Como a execução de C funciona

O projeto não compila C dentro do navegador. A compilação acontece no Judge0,
um serviço externo de execução de código.

### Requisição enviada pelo frontend

O frontend envia um JSON semelhante a este:

```json
{
  "sourceCode": "#include <stdio.h>\nint main() { return 0; }",
  "languageId": 50,
  "stdin": ""
}
```

O `languageId` `50` representa GNU C no Judge0.

### Validação no backend

Em [server/index.ts](./server/index.ts), o Express usa
`express.json({ limit: "64kb" })`. Depois, `/api/run` valida:

- `sourceCode` deve ser uma string não vazia;
- `sourceCode` não pode passar de 100 KB;
- `stdin` deve ser uma string;
- `languageId` deve ser um inteiro positivo, ou o valor padrão `50`.

Quando a entrada é inválida, a API responde `400` com um objeto contendo
`error`.

A validação é importante porque o navegador não é uma fronteira de confiança:
qualquer pessoa pode enviar uma requisição manual para o backend.

### Codificação Base64

O Judge0 é chamado com `base64_encoded=true`. Por isso, o backend converte
`sourceCode` e `stdin` para Base64 antes de montar a requisição:

```text
texto UTF-8 → Buffer → Base64 → Judge0
```

Isso evita problemas de transporte com acentos, quebras de linha e caracteres
especiais. No retorno, os campos `stdout`, `stderr`, `compile_output` e
`message` são decodificados de Base64 para texto UTF-8.

### Chamada ao Judge0

O backend faz um `POST` para:

```text
{JUDGE0_URL}/submissions?base64_encoded=true&wait=true
```

O parâmetro `wait=true` faz o Judge0 esperar a conclusão da execução antes de
responder. O corpo enviado contém:

```json
{
  "source_code": "código em Base64",
  "language_id": 50,
  "stdin": "entrada em Base64"
}
```

### Timeout e erros

Um `AbortController` cancela a requisição se ela ultrapassar
`JUDGE0_TIMEOUT_MS`, cujo padrão é 30 segundos.

As respostas principais são:

| Situação | Status | Comportamento |
| --- | ---: | --- |
| Código ou parâmetros inválidos | `400` | Retorna uma mensagem de validação |
| Judge0 rejeita a submissão | status do Judge0 | Registra detalhes no servidor e devolve erro |
| Judge0 excede o timeout | `504` | Informa que o limite foi ultrapassado |
| Falha de rede ou serviço | `502` | Informa que o Judge0 não pôde ser acessado |
| Execução aceita | `200` | Retorna o resultado decodificado |

No navegador, a saída é escolhida nesta ordem:

1. `stdout`, quando o programa imprimiu saída normal;
2. `stderr`, quando houve erro durante a execução;
3. `compile_output`, quando a compilação falhou;
4. `message`, quando o Judge0 fornece uma mensagem;
5. mensagem genérica de execução sem saída.

## Como a colaboração funciona

Existe uma implementação colaborativa em [src/main.ts](./src/main.ts). Ela
usa:

- `monaco-editor` para o editor;
- `yjs` para representar o texto como estrutura compartilhada;
- `y-monaco` para ligar o texto Yjs ao modelo do Monaco;
- `y-webrtc` para comunicação entre navegadores;
- servidores de sinalização WebRTC públicos.

### Identificação da sala

Ao abrir a página principal, `src/collaboration.ts` procura `room` na URL:

```text
?room=ABC123
```

Se não existir, cria um código aleatório de seis caracteres usando
`crypto.randomUUID()`, coloca o código na URL e cria o documento:

```text
console-room-ABC123
```

Duas pessoas que usam o mesmo código entram no mesmo documento Yjs.

### Como a sincronização funciona hoje

A implementação atualmente usada pela página principal separa o fluxo em três
responsabilidades:

```text
Firebase Authentication
  └── identifica anonimamente cada navegador

Firebase Realtime Database
  └── controla a sala e os participantes online

Yjs + y-webrtc
  └── sincroniza o conteúdo dos arquivos
```

O Firebase **não sincroniza o código**. Ele apenas controla quem entrou na
sala. O código é mantido em estruturas Yjs e transportado entre os navegadores
pelo `WebrtcProvider`. O limite beta atual é de oito participantes por sala.

#### 1. A página escolhe a sala

O código lê `?room=ABC123`. Se o parâmetro não existir, gera um código e
atualiza a URL com `history.replaceState`. O nome usado pelo Yjs é:

```text
console-room-ABC123
```

Qualquer navegador que abra exatamente esse mesmo código usa a mesma sala Yjs.
Um código diferente cria outro documento e, portanto, outra sala.

#### 2. O navegador recebe uma identidade anônima

`signInAnonymously()` cria ou recupera um identificador do Firebase para aquele
navegador. O usuário não precisa informar e-mail, senha ou criar uma conta.
Esse identificador é usado para separar o arquivo pessoal de cada participante.

O nome exibido, como `Usuario` ou `Joao`, é apenas um dado de presença salvo
junto ao identificador anônimo. Ele não é uma credencial de autenticação.

#### 3. A entrada na sala é controlada por uma transação

O Realtime Database mantém os participantes em:

```text
rooms/ABC123/members/<firebase-user-id>
```

Ao entrar, `runTransaction()` verifica a quantidade atual de participantes.
Para o beta, a transação recusa uma nona pessoa. Depois da entrada, o
`onDisconnect()` agenda a remoção automática do participante quando a conexão
for encerrada.

Um listener `onValue()` acompanha `members` e atualiza:

- o contador `Usuários (1/8)` até `Usuários (8/8)`;
- a lista de nomes no painel de usuários;
- as abas dos arquivos disponíveis.

#### 4. Cada participante possui um `Y.Text` próprio

Os arquivos não são salvos no Firebase. Para evitar conflitos entre estruturas
aninhadas, cada arquivo é obtido diretamente do documento Yjs com um nome
determinístico:

```ts
ydoc.getText(`console-file-${fileKey}`)
```

O `fileKey` de um participante é:

```text
personal:<firebase-user-id>
```

Assim, os dois navegadores obtêm exatamente o mesmo `Y.Text` quando acessam o
arquivo de uma mesma pessoa.

O nome mostrado depende de quem está olhando:

| Participante atual | Arquivo próprio | Arquivo do outro |
| --- | --- | --- |
| Criador `Usuario` | `main.c` | `Joao.c` |
| Convidado `Joao` | `main.c` | `Usuario.c` |

`main.c` é apenas o rótulo visual do arquivo próprio. Internamente, o arquivo
continua identificado pelo `firebase-user-id`, então não existe colisão entre
os dois `main.c`.

#### 5. O editor troca de arquivo

Quando uma aba é selecionada, o código:

1. encontra o `Y.Text` correspondente;
2. remove o observador do arquivo anterior;
3. registra um observador no novo arquivo;
4. copia o conteúdo do `Y.Text` para o `textarea`;
5. passa a enviar as próximas edições para esse `Y.Text`.

A alteração local é comparada com o último valor sincronizado. O código calcula
o menor trecho comum no início e no fim e envia ao Yjs apenas a operação
necessária de `delete` e/ou `insert`. O documento não é apagado e reinserido
inteiro a cada tecla. Isso permite que o Yjs combine alterações próximas ou
simultâneas usando seu algoritmo CRDT.

Quando o Yjs recebe uma alteração remota, o observador aplica o `delta`
incremental ao `textarea` sem gerar uma nova alteração local. A flag
`applyingRemoteChange` evita um ciclo de atualização:

```text
Yjs remoto → textarea → evento input → Yjs
                         X
```

O observador mantém o texto do editor e do Yjs alinhados. Atualizações remotas
preservam a posição atual do cursor tanto quanto possível. A posição exibida na
barra inferior é calculada a partir de `selectionStart` do `textarea`: `Ln` é
a linha e `Col` é a coluna do cursor, ambas começando em 1. Ela é recalculada
ao digitar, clicar no editor, mover o cursor pelo teclado ou alterar a seleção.

#### 6. Inicialização do conteúdo

O `WebrtcProvider` precisa sincronizar antes de o participante convidado
inicializar seu arquivo. Por isso:

- o criador usa o conteúdo inicial que já estava no editor;
- o convidado espera o provider sincronizar;
- se o arquivo pessoal do convidado ainda estiver vazio, ele recebe o
  `Hello World` inicial;
- se o arquivo já existir no Yjs, seu conteúdo é preservado;
- depois disso, o arquivo selecionado passa a aceitar edições.

Essa ordem evita que o conteúdo local de um navegador sobrescreva o conteúdo
que já existe na sala.

#### 7. Como os navegadores se encontram

O `WebrtcProvider` usa a variável `VITE_YJS_SIGNALING_URL`, com
`wss://signaling.yjs.dev` como padrão, para descobrir outros navegadores na
mesma sala. O servidor de sinalização troca apenas as informações necessárias
para estabelecer a conexão; ele não é o banco de dados dos arquivos.

Depois da descoberta, o WebRTC transporta as atualizações Yjs entre os
navegadores. Portanto, todos precisam:

- usar o mesmo código `room`;
- conseguir conectar ao servidor WebSocket de sinalização;
- conseguir estabelecer a conexão WebRTC;
- manter a página aberta para continuar participando.

O evento `synced` libera a inicialização do editor convidado. O evento `status`
atualiza a mensagem de colaboração quando a conexão fica offline.

### Convite e lista de usuários

O botão verde `+` abre um popup com o código da sala em destaque e um ícone de
cópia dentro da própria barra do código. O botão **X** fecha o popup, e o
formulário permite informar o código de outra sala. O botão **Entrar** troca a
URL para a sala digitada; o Firebase então valida a entrada e aplica o limite
de oito participantes. O botão **Usuários** abre a lista de participantes
atualmente registrados no Realtime Database. A lista é presença ao vivo, não
um histórico: quando o `onDisconnect()` remove um participante, o contador e as
abas são atualizados nos navegadores restantes.

### Atalhos e entrada do `scanf`

- `Ctrl+Enter` (ou `Cmd+Enter` no macOS) aciona **Run**.
- `Esc` aciona **Stop**; com um modal aberto, primeiro fecha o modal.
- `Ctrl+C` e `Ctrl+V` (ou `Cmd+C` e `Cmd+V` no macOS) copiam e colam usando a
  seleção nativa do editor. O botão com ícone de cópia continua copiando o
  código completo.

Quando o código contém uma chamada a `scanf`, a barra de entrada do resultado
mostra o rótulo `SCANF` ao lado do campo para deixar claro qual comando está
aguardando os dados.

### Trabalho offline e recuperação local

O documento Yjs também é espelhado no IndexedDB do navegador pelo
`y-indexeddb`. Isso permite manter as alterações neste dispositivo durante uma
queda temporária de rede e restaurar o estado local ao recarregar a sala. Ao
reconectar, o provider WebRTC sincroniza as atualizações Yjs com o outro
participante.

Esse cache é local ao perfil/navegador e à sala. Ele não é enviado ao Firebase
nem é um backup de servidor: limpar os dados do site ou usar outro dispositivo
remove o acesso a essa cópia. Se ambos os usuários estiverem offline ao mesmo
tempo, as cópias locais só poderão se reconciliar quando voltarem a se conectar.
O indicador `ms` na barra inferior mostra o tempo de CPU reportado pelo Judge0
quando disponível; caso contrário, mostra o tempo total da requisição,
incluindo rede e espera pelo serviço.

### Posicionamento dos botões do topo

Os estilos da barra ficam no `<style>` de [`index.html`](./index.html):

- `.topbar` controla o layout e o espaçamento geral da barra;
- `.user-identity` controla a posição da identidade do usuário;
- `.topbar-actions` controla os botões `Usuários` e `+`;
- `gap` define a distância entre eles;
- `margin-left: auto` empurra o grupo para o lado direito;
- `transform: translateX(...)` desloca visualmente um grupo sem alterar a
  ordem do layout.

A ordem normal dos elementos vem do HTML: `Usuários` aparece antes de `+`.
Para inverter a posição, pode-se trocar a ordem dos dois botões no HTML ou
usar `order` no CSS, por exemplo:

```css
#usersButton {
  order: 2;
}

#inviteUsersButton {
  order: 1;
}
```

Para aproximar ou afastar os botões, ajuste `gap` em `.topbar-actions`.

O projeto ainda não possui chat persistente. O código de chat que existe na
implementação alternativa de `src/main.ts` adiciona mensagens somente ao DOM
local e não faz parte da sincronização do editor principal.

## Como configurar o Firebase

O beta usa o Firebase somente para autenticação anônima e controle da sala.
O conteúdo do editor continua sendo sincronizado pelo Yjs/WebRTC. Nenhum
login ou cadastro é exibido para o usuário.

O Yjs precisa de um servidor de sinalização WebSocket para encontrar os
navegadores. A configuração padrão usa `wss://signaling.yjs.dev`. Essa
sinalização não armazena o código: depois que os navegadores se encontram, a
sincronização ocorre diretamente entre eles. Para usar um servidor próprio,
defina `VITE_YJS_SIGNALING_URL` no ambiente do Vite e na Vercel.

Se o servidor público não estiver disponível, o projeto também pode iniciar
um servidor próprio com `npm run signaling`. Esse processo deve ficar em uma
hospedagem que suporte WebSocket, como um Web Service do Render; ele não deve
ser publicado como função serverless da Vercel.

Cada participante possui um arquivo próprio dentro da sala. O dono da sala vê
o próprio arquivo como `main.c`; os demais arquivos aparecem com o nome do
respectivo participante, como `Joao.c`. O participante convidado vê o próprio
arquivo como `main.c` e o arquivo do dono com o nome dele. Todos os arquivos
podem ser selecionados e editados por qualquer participante da sala.

### 1. Criar o projeto

1. Acesse o [Firebase Console](https://console.firebase.google.com/).
2. Crie um projeto.
3. Adicione um aplicativo Web.
4. Em **Authentication > Sign-in method**, habilite **Anonymous**.
5. Em **Realtime Database**, crie um banco de dados.
6. Publique o conteúdo de
   [`firebase.database.rules.json`](./firebase.database.rules.json) em
   **Realtime Database > Rules**.

Se o Firebase já estava configurado, publique as regras atualizadas do arquivo.
As regras usam apenas operações suportadas pelo Realtime Database. O limite de
oito é verificado pela transação de entrada no cliente; as regras do RTDB não
contam filhos de um objeto, portanto não aplicam esse limite contra clientes
modificados manualmente.

O cliente limita cada sala a oito participantes usando uma transação atômica no
Realtime Database. Isso evita entradas acima do limite pelo aplicativo normal,
incluindo corridas entre usuários simultâneos, mas não é uma barreira de
segurança contra clientes alterados. Para impor o limite no servidor, será
necessário mover a admissão para uma Cloud Function/servidor confiável. As
regras atuais não são uma solução de autorização permanente para a versão
futura com mais usuários.

### 2. Configurar o ambiente local

Copie [`.env.example`](./.env.example) para `.env.local` e preencha os valores
do aplicativo Web fornecidos pelo Firebase:

```sh
cp .env.example .env.local
```

O arquivo `.env.local` não deve ser commitado. As variáveis usadas pelo
frontend são:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

### 3. Testar uma sala com até oito pessoas

Execute:

```sh
npm run dev
```

Abra a URL exibida pelo Vite. O aplicativo gera uma sala e coloca o código na
URL, por exemplo `?room=ABC123`. Compartilhe essa URL com até sete pessoas em
outros navegadores ou dispositivos. Cada pessoa entra anonimamente, e as
alterações nos arquivos são sincronizadas pelo Yjs.

Uma nona pessoa recebe uma mensagem informando que a sala está cheia ao entrar
pelo aplicativo. Neste beta, o código da sala funciona como convite; não existe
autenticação visível para o usuário.

### 4. Publicar na Vercel

Na configuração do projeto na Vercel, adicione as mesmas variáveis `VITE_*`
do `.env.local`. Elas são incorporadas ao bundle do frontend durante o build;
isso é esperado para a configuração pública do Firebase. A proteção real vem
das Security Rules.

O frontend e a função serverless de execução são publicados juntos na Vercel.
A função está em [`api/run.ts`](./api/run.ts) e mantém o endpoint relativo
`/api/run` usado pelo frontend. O Firebase não executa essa API nem compila o
C.

Na Vercel, adicione também estas variáveis em **Settings > Environment
Variables**:

```text
JUDGE0_URL=https://ce.judge0.com
JUDGE0_TIMEOUT_MS=8000
JUDGE0_AUTH_TOKEN=
```

`JUDGE0_AUTH_TOKEN` é opcional e só deve ser preenchida se a instância do
Judge0 exigir autenticação. Ela não deve começar com `VITE_`, pois é segredo de
servidor e nunca pode ser enviado ao navegador.

O limite padrão da função é de 8 segundos para funcionar no plano gratuito da
Vercel. Programas pequenos devem executar normalmente; execuções que excederem
esse limite retornam `504`. O backend Express em
[`server/index.ts`](./server/index.ts) continua disponível para desenvolvimento
local com `npm run dev:all`.

### 5. Hospedar o sinalizador WebSocket no Render

Para evitar a dependência do `wss://signaling.yjs.dev`, crie um **Web Service**
no Render apontando para este repositório e use:

```text
Runtime: Node
Build Command: npm install
Start Command: npm run signaling
```

Não informe uma porta fixa: o servidor usa automaticamente a variável `PORT`
fornecida pelo Render. Depois do deploy, o Render fornecerá uma URL HTTPS,
por exemplo:

```text
https://console-plus-signaling.onrender.com
```

Na Vercel, altere a variável pública:

```text
VITE_YJS_SIGNALING_URL=wss://console-plus-signaling.onrender.com
```

Troque `https://` por `wss://`, salve para **Production** e **Preview** e faça
um novo deploy da Vercel. O servidor de sinalização precisa permanecer como
Web Service; funções serverless não mantêm o WebSocket persistente necessário
pelo `y-webrtc`.

Para oito participantes, não é necessário alterar a configuração do serviço
Render: o servidor de sinalização continua apenas coordenando a descoberta
entre peers. O tráfego de código é enviado diretamente por WebRTC. Com oito
participantes, porém, cada navegador pode manter até sete conexões peer a peer
(28 conexões no total na sala), então a rede dos participantes pode afetar a
estabilidade. O plano Free do Render pode suspender o serviço após inatividade;
para testes isso pode ser suficiente, mas, se a sinalização precisar estar
sempre disponível, considere um plano pago. O número de participantes também
aumenta o uso do Realtime Database para presença; monitore o uso e o faturamento
no Firebase, sem necessidade de mudar as regras além de publicar o novo limite.

## Backend e API

### `POST /api/run`

Executa um programa no Judge0.

Exemplo:

```sh
curl -X POST http://localhost:3001/api/run \
  -H 'content-type: application/json' \
  -d '{
    "sourceCode": "#include <stdio.h>\nint main() { printf(\"oi\\n\"); return 0; }",
    "languageId": 50,
    "stdin": ""
  }'
```

### `GET /api/health`

Verifica se o backend está vivo:

```sh
curl http://localhost:3001/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "console-backend"
}
```

### `GET /`

O backend também entrega o arquivo `index.html` na rota `/`. Isso permite
acessar a interface diretamente pelo servidor Express, embora o fluxo de
desenvolvimento recomendado use o Vite.

O arquivo é resolvido com base no diretório de onde o processo Node foi
iniciado:

```text
process.cwd()/index.html
```

Por isso, execute `npm run server` na raiz do projeto.

## Instalação e execução

### Pré-requisitos

- Node.js com suporte a `fetch` nativo;
- npm;
- acesso à internet para o Judge0;
- acesso aos servidores de sinalização WebRTC caso a implementação
  colaborativa seja usada.

### Instalar dependências

Na raiz do projeto:

```sh
npm install
```

### Executar frontend e backend juntos

O caminho mais simples é:

```sh
npm run dev:all
```

Esse comando usa `concurrently` para iniciar:

- Vite em `http://localhost:5173`;
- Express em `http://localhost:3001`.

Abra:

```text
http://localhost:5173
```

### Executar em dois terminais

Terminal 1:

```sh
npm run server
```

Terminal 2:

```sh
npm run dev
```

Depois abra `http://localhost:5173`.

### Executar apenas o backend

```sh
npm run server
```

O backend informa no terminal a URL em que está escutando. A rota `/` entrega
o `index.html`, e `/api/health` pode ser usada para conferir o funcionamento.

### Abrir o HTML diretamente

Também é possível abrir `index.html` com um servidor estático, por exemplo:

```sh
python3 -m http.server 8000
```

Porém, esse modo serve apenas a interface. O endpoint relativo `/api/run` não
existirá nesse servidor, então a execução de C não funcionará sem um backend
Express acessível e sem uma configuração de proxy adequada.

## Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3001` | Porta do backend Express |
| `JUDGE0_URL` | `https://ce.judge0.com` | URL da instância do Judge0 |
| `JUDGE0_TIMEOUT_MS` | `30000` | Tempo máximo de espera do Judge0 |

Exemplo:

```sh
PORT=4000 \
JUDGE0_URL=https://meu-judge0.example.com \
JUDGE0_TIMEOUT_MS=45000 \
npm run server
```

Se a porta do backend mudar durante o desenvolvimento, o proxy em
[vite.config.ts](./vite.config.ts) também precisa ser atualizado.

## Scripts disponíveis

Os scripts estão em [package.json](./package.json):

| Script | O que faz |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento do Vite |
| `npm run server` | Inicia a API Express com `tsx` |
| `npm run dev:all` | Inicia Vite e Express ao mesmo tempo |
| `npm run build` | Executa o TypeScript e gera a build de produção do Vite |

### Build

Para validar o TypeScript e gerar os arquivos finais:

```sh
npm run build
```

O comando executa `tsc -b` e depois `vite build`. A saída é gravada em
`dist/`.

## Limitações atuais

Estas limitações fazem parte do estado atual do projeto:

1. A autenticação atual é anônima; ainda não há contas permanentes ou perfis.
2. O nome exibido é uma preferência local sincronizada apenas como presença da
   sala; ele não é uma credencial.
3. O chat da implementação alternativa em `src/main.ts` não é persistente e
   não faz parte da interface principal.
4. O convite não envia e-mail nem cria permissões permanentes.
5. A interface principal usa um `textarea` sincronizado diretamente com Yjs;
   Monaco/Yjs continua disponível apenas na implementação alternativa de
   `src/main.ts`.
6. O botão `Stop` não aborta uma execução já enviada ao Judge0.
7. A execução depende de um serviço Judge0 externo.
8. Não há histórico de execuções ou salvamento em banco de dados.
9. Não há seleção de linguagem na interface; o frontend sempre envia
   `languageId: 50`.
10. O destaque de sintaxe é baseado em regex, não em um parser de C.
11. O endpoint `/api/run` não possui autenticação, rate limit ou cota por
    usuário.
12. A disponibilidade da colaboração WebRTC depende do servidor configurado em
    `VITE_YJS_SIGNALING_URL`, de WebRTC e da conectividade dos navegadores.
13. Os documentos Yjs são mantidos em cache IndexedDB nos dispositivos que
    acessaram a sala, mas não são persistidos em um banco/servidor central.
    Apagar os dados do navegador remove essa cópia local.
14. A sala e a presença ficam no Firebase, mas o Firebase não mantém histórico
    ou backup central do código.

## Segurança e produção

O backend aceita código arbitrário para execução remota. Antes de publicar
este projeto na internet, implemente pelo menos:

- autenticação e autorização;
- rate limiting por IP e por usuário;
- limite de tamanho para código e entrada;
- limite de tempo, memória, processos e saída;
- isolamento adequado do executor;
- logs sem expor código-fonte ou dados sensíveis;
- proteção contra abuso automatizado;
- CORS e política de origem apropriados;
- HTTPS;
- uma instância Judge0 controlada ou um provedor com limites conhecidos;
- monitoramento e alertas;
- política de retenção para dados de salas e execuções.

O Base64 usado na integração não é criptografia. Ele apenas representa bytes
em texto para transporte. O código enviado ao Judge0 deve ser considerado
potencialmente sensível e a infraestrutura deve ser configurada de acordo com
essa realidade.

Também não se deve confiar em validações feitas apenas no frontend. O backend
precisa repetir todas as validações importantes, pois clientes podem ignorar
completamente a interface e chamar a API diretamente.

## Manutenção e próximos passos

Uma evolução natural do projeto seria:

1. escolher oficialmente entre a implementação inline atual e a implementação
   Monaco/Yjs;
2. mover o frontend para arquivos TypeScript separados;
3. adicionar testes para validação da API e decodificação do Judge0;
4. usar `AbortController` também no frontend para implementar um Stop real;
5. criar autenticação e salas persistentes;
6. armazenar histórico de código e execuções;
7. adicionar seleção de linguagem;
8. substituir o destaque por um serviço de linguagem ou parser apropriado;
9. configurar uma instância Judge0 própria;
10. adicionar observabilidade, limites e proteção contra abuso.

## Resumo em uma frase

O navegador edita e salva localmente um programa C, envia esse programa para a
API Express, a API valida e encaminha o código codificado ao Judge0, recebe o
resultado da compilação/execução, decodifica a resposta e mostra a saída no
painel de resultado.
