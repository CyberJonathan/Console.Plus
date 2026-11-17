import * as monaco from "monaco-editor";
import { MonacoBinding } from "y-monaco";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import "./style.css";

const starterCode = `#include <stdio.h>

int main() {
    printf("Olá, mundo!\\n");
    return 0;
}`;

const editorElement = document.querySelector<HTMLElement>("#codeEditor")!;
const runButton = document.querySelector<HTMLButtonElement>("#runButton")!;
const terminal = document.querySelector<HTMLElement>("#terminalOutput")!;
const runStatus = document.querySelector<HTMLElement>("#runStatus")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const cursorPosition = document.querySelector<HTMLElement>("#cursorPosition")!;

if (!editorElement || !runButton || !terminal || !runStatus || !toast) {
  throw new Error("A interface do editor não foi encontrada.");
}

const roomFromUrl = new URLSearchParams(location.search).get("room");
const roomCode = roomFromUrl?.toUpperCase() ?? crypto.randomUUID().slice(0, 6).toUpperCase();
if (!roomFromUrl) {
  history.replaceState(null, "", `${location.pathname}?room=${roomCode}`);
}
const documentId = `console-room-${roomCode}`;
const ydoc = new Y.Doc();
const provider = new WebrtcProvider(documentId, ydoc, {
  signaling: ["wss://y-webrtc-eu.fly.dev", "wss://y-webrtc-us.fly.dev"],
});
const ytext = ydoc.getText("main.c");
const model = monaco.editor.createModel(ytext.toString(), "cpp");
monaco.editor.defineTheme("console-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#17191c",
    "editorGutter.background": "#17191c",
    "editorLineNumber.foreground": "#565b63",
    "editorLineNumber.activeForeground": "#a5abb4",
    "editor.lineHighlightBackground": "#202328",
    "editorIndentGuide.background": "#24272c",
    "editorIndentGuide.activeBackground": "#343941",
  },
});
const codeEditor = monaco.editor.create(editorElement, {
  model,
  theme: "console-dark",
  automaticLayout: true,
  minimap: { enabled: false },
  fontFamily: "'DM Mono', monospace",
  fontSize: 13,
  lineHeight: 24,
  padding: { top: 20, bottom: 24 },
  scrollBeyondLastLine: false,
  renderLineHighlight: "line",
  tabSize: 4,
});
new MonacoBinding(ytext, model, new Set([codeEditor]), provider.awareness);

if (ytext.length === 0) ytext.insert(0, starterCode);
provider.on("status", ({ connected }: { connected: boolean }) => {
  const savedLabel = document.querySelector<HTMLElement>(".saved-label");
  if (savedLabel) {
    savedLabel.innerHTML = `<span class="saved-dot"></span> ${connected ? "Sincronizado" : "Offline"}`;
  }
});

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function updateCursorPosition(): void {
  const position = codeEditor.getPosition();
  if (position) cursorPosition.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
}

async function copyCode(): Promise<void> {
  await navigator.clipboard.writeText(ytext.toString());
  showToast("Código copiado. Cole onde quiser!");
}

async function runCode(): Promise<void> {
  runButton.disabled = true;
  runButton.querySelector("span")!.textContent = "Compilando...";
  runStatus.textContent = "Compilando…";
  terminal.textContent = "";

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceCode: ytext.toString(), languageId: 50 }),
    });
    const result = (await response.json()) as {
      error?: string;
      stdout?: string;
      stderr?: string;
      compile_output?: string;
      status?: { description?: string };
    };
    if (!response.ok) throw new Error(result.error ?? "Falha na execução.");
    terminal.textContent = result.stdout || result.stderr || result.compile_output || "Execução concluída sem saída.";
    runStatus.textContent = result.status?.description ?? "Executado";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada.";
    terminal.textContent = message;
    runStatus.textContent = "Backend indisponível";
    showToast("Inicie o backend com `npm run dev:all` para executar C.");
  } finally {
    runButton.disabled = false;
    runButton.querySelector("span")!.textContent = "Compilar e executar";
  }
}

document.querySelector("#copyButton")?.addEventListener("click", () => void copyCode());
runButton.addEventListener("click", () => void runCode());
codeEditor.onDidChangeCursorPosition(updateCursorPosition);
updateCursorPosition();
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (!runButton.disabled) void runCode();
  }
});
document.querySelector("#chatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>("#chatInput");
  const messages = document.querySelector<HTMLElement>("#chatMessages");
  const count = document.querySelector<HTMLElement>("#messageCount");
  if (!input || !messages || !count || !input.value.trim()) return;
  const article = document.createElement("article");
  article.className = "message";
  article.innerHTML = `<div class="message-heading"><strong>João Developer</strong><time>agora</time></div><p></p>`;
  article.querySelector("p")!.textContent = input.value.trim();
  messages.append(article);
  count.textContent = String(messages.children.length);
  input.value = "";
});

const inviteDialog = document.querySelector<HTMLDialogElement>("#inviteDialog");
const inviteForm = document.querySelector<HTMLFormElement>("#inviteForm");
const roomCodeInput = document.querySelector<HTMLInputElement>("#roomCode");
const joinRoomCode = document.querySelector<HTMLInputElement>("#joinRoomCode");
const joinRoomButton = document.querySelector<HTMLButtonElement>("#joinRoomButton");
const copyRoomCode = document.querySelector<HTMLButtonElement>("#copyRoomCode");
const inviteFeedback = document.querySelector<HTMLElement>("#inviteFeedback");

function openInviteDialog(): void {
  if (!inviteDialog || !inviteFeedback || !roomCodeInput) return;
  roomCodeInput.value = roomCode;
  inviteFeedback.textContent = "";
  inviteDialog.showModal();
  roomCodeInput.select();
}

for (const selector of ["#inviteButton", "#sidebarInviteButton", "#collaboratorAvatar"]) {
  document.querySelector(selector)?.addEventListener("click", openInviteDialog);
}
document.querySelector("#closeDialog")?.addEventListener("click", () => inviteDialog?.close());
inviteForm?.addEventListener("submit", (event) => event.preventDefault());
copyRoomCode?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(roomCode);
  showToast(`Código ${roomCode} copiado.`);
});
joinRoomButton?.addEventListener("click", () => {
  const requestedRoom = joinRoomCode?.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!requestedRoom || requestedRoom.length < 4) {
    if (inviteFeedback) inviteFeedback.textContent = "Informe um código de sala válido.";
    return;
  }
  location.assign(`${location.pathname}?room=${requestedRoom}`);
});
