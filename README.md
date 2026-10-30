# Console — editor online de C

O Console é uma aplicação web experimental para escrever, compilar e executar
programas em C no navegador. A interface tem um visual escuro e minimalista,
com editor de código, destaque de sintaxe, numeração de linhas, entrada para
`scanf`, área de resultado e ações de copiar e executar.

O projeto também contém uma implementação colaborativa baseada em Monaco,
Yjs e WebRTC em [src/main.ts](./src/main.ts). Essa implementação é uma segunda
superfície de código que está preparada para o editor colaborativo, mas a
página usada atualmente pelo Vite é [index.html](./index.html), que contém a
interface principal e seu JavaScript inline.

## Índice

- [Visão geral da arquitetura](#visão-geral-da-arquitetura)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Fluxo completo da aplicação](#fluxo-completo-da-aplicação)
- [Como o editor funciona](#como-o-editor-funciona)
- [Como a execução de C funciona](#como-a-execução-de-c-funciona)
- [Como a colaboração funciona](#como-a-colaboração-funciona)
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

Ao abrir a implementação de `src/main.ts`, o código procura `room` na URL:

```text
?room=ABC123
```

Se não existir, cria um código aleatório de seis caracteres usando
`crypto.randomUUID()`, coloca o código na URL e cria o documento:

```text
console-room-ABC123
```

Duas pessoas que usam o mesmo código entram no mesmo documento Yjs.

### Sincronização

O `WebrtcProvider` conecta os participantes à mesma sala. O `MonacoBinding`
mantém o conteúdo do modelo do Monaco e o `Y.Text` sincronizados. Alterações
feitas por um participante são propagadas para os demais participantes da
mesma sala.

O status visual muda entre `Sincronizado` e `Offline` conforme o provider
informa seu estado de conexão.

### Convite e chat

Ainda nessa implementação, o código:

- abre um diálogo para copiar o código da sala;
- permite informar outro código de sala;
- adiciona mensagens visualmente ao chat local.

O chat não possui backend nem persistência. A mensagem é adicionada apenas ao
DOM da aba atual. O convite também não envia e-mail: ele apenas facilita o
compartilhamento do código da sala.

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

1. Não há autenticação, contas ou autorização.
2. O nome do usuário é apenas uma preferência local.
3. O chat da implementação em `src/main.ts` não é persistente.
4. O convite não envia e-mail nem cria permissões.
5. A interface principal de `index.html` não usa Monaco nem Yjs.
6. O botão `Stop` não aborta uma execução já enviada ao Judge0.
7. A execução depende de um serviço Judge0 externo.
8. Não há histórico de execuções ou salvamento em banco de dados.
9. Não há seleção de linguagem na interface; o frontend sempre envia
   `languageId: 50`.
10. O destaque de sintaxe é baseado em regex, não em um parser de C.
11. O endpoint `/api/run` não possui autenticação, rate limit ou cota por
    usuário.
12. A disponibilidade da colaboração WebRTC depende dos servidores públicos de
    sinalização e da conectividade dos navegadores.

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
