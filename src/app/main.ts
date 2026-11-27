import { createAppState, createExecutionRequest } from "./state.js";
import { createCompiler } from "../compiler/compiler-service.js";
import type { ExecutionSession } from "./state.js";
import { initializeEditor } from "../editor/editor.js";
import {
  getSavedSourceCode,
  getSavedUserName,
  saveSourceCode,
  saveUserName,
} from "../storage/local-storage.js";

const output = document.querySelector<HTMLElement>("#resultOutput");
const toast = document.querySelector<HTMLElement>("#toast");
const executionStatus = document.querySelector<HTMLElement>("#executionStatus");
const executionTime = document.querySelector<HTMLElement>("#executionTime");
const stdinForm = document.querySelector<HTMLFormElement>("#stdinForm");
const stdinInput = document.querySelector<HTMLInputElement>("#stdinInput");
const stdinSubmitButton = document.querySelector<HTMLButtonElement>("#stdinSubmitButton");
const stdinEofButton = document.querySelector<HTMLButtonElement>("#stdinEofButton");
const runButton = document.querySelector<HTMLButtonElement>("#runButton");
const stopButton = document.querySelector<HTMLButtonElement>("#stopButton");
const copyButton = document.querySelector<HTMLButtonElement>("#copyButton");
const userIdentity = document.querySelector<HTMLButtonElement>("#userIdentity");
const userName = document.querySelector<HTMLElement>("#userName");
const userAvatar = document.querySelector<HTMLElement>(".user-avatar");
const firstPresenceIcon = document.querySelector<HTMLElement>(".presence-icon");
const nameModal = document.querySelector<HTMLElement>("#nameModal");
const nameForm = document.querySelector<HTMLFormElement>("#nameForm");
const nameInput = document.querySelector<HTMLInputElement>("#nameInput");
const nameError = document.querySelector<HTMLElement>("#nameError");
const cancelNameButton = document.querySelector<HTMLButtonElement>("#cancelNameButton");
const roomDialog = document.querySelector<HTMLDialogElement>("#roomDialog");

if (
  !output || !toast || !executionStatus || !executionTime || !stdinForm ||
  !stdinInput || !stdinSubmitButton || !stdinEofButton || !runButton ||
  !stopButton || !copyButton || !userIdentity || !userName || !userAvatar ||
  !firstPresenceIcon || !nameModal || !nameForm || !nameInput || !nameError ||
  !cancelNameButton || !roomDialog
) {
  throw new Error("Elementos necessários para inicializar a aplicação não foram encontrados.");
}

const appState = createAppState();
const compiler = createCompiler();
const MAX_SESSION_INPUTS = 50;
let toastTimer: number | undefined;

const editor = initializeEditor({
  initialCode: getSavedSourceCode(),
  onCodeChanged: saveSourceCode,
});

function updateUserIdentity(name: string): void {
  const normalizedName = name.trim().replace(/\s+/g, " ").slice(0, 32);
  if (!normalizedName) return;
  const initials = normalizedName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  userName!.textContent = normalizedName;
  userAvatar!.textContent = initials;
  firstPresenceIcon!.textContent = initials;
  saveUserName(normalizedName);
  window.dispatchEvent(new CustomEvent("console:user-name-changed", {
    detail: { name: normalizedName },
  }));
}

function setExecutionStatus(message: string, state = ""): void {
  executionStatus!.textContent = message;
  executionStatus!.className = `execution-status ${state}`.trim();
}

function setOutput(message: string, state: string): void {
  output!.className = `result-output ${state}`;
  output!.replaceChildren();
  for (const [index, line] of message.split("\n").entries()) {
    if (index > 0) output!.append(document.createTextNode("\n"));
    const prompt = document.createElement("span");
    const text = document.createElement("span");
    prompt.className = "prompt";
    prompt.textContent = "●";
    text.textContent = line;
    output!.append(prompt, text);
  }
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast!.textContent = message;
  toast!.classList.add("visible");
  toastTimer = window.setTimeout(() => toast!.classList.remove("visible"), 1800);
}

function setStdinVisible(visible: boolean, busy = false): void {
  stdinForm!.hidden = !visible;
  stdinInput!.disabled = busy || !visible;
  stdinSubmitButton!.disabled = busy || !visible;
  stdinEofButton!.disabled = busy || !visible || !appState.executionSession;
  if (visible && !busy && !stdinInput!.disabled) stdinInput!.focus();
}

function renderInteractiveTranscript(session: ExecutionSession, stdout: string): string {
  let transcript = "";
  let offset = 0;
  for (const entry of session.inputs) {
    const entryOffset = Math.min(Math.max(entry.stdoutOffset, offset), stdout.length);
    transcript += stdout.slice(offset, entryOffset);
    transcript += `${entry.text}\n`;
    offset = entryOffset;
  }
  return transcript + stdout.slice(offset);
}

function createSessionSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

async function executeSession(session: ExecutionSession, sendEof = false): Promise<void> {
  const controller = new AbortController();
  appState.activeRunController = controller;
  setStdinVisible(!stdinForm!.hidden, true);
  setExecutionStatus("Executando...", "waiting");

  try {
    const result = await compiler.run(
      createExecutionRequest(session, sendEof),
      controller.signal,
    );
    if (appState.executionSession !== session) return;

    session.lastStdout = result.stdout;
    const transcript = renderInteractiveTranscript(session, result.stdout);
    const message = [transcript, result.compileOutput, result.stderr].filter(Boolean).join("\n");
    const waitingForInput = result.needsInput && !result.failed;
    executionTime!.textContent = `${result.executionTimeMs} ms`;

    setOutput(
      message || "Programa executado sem saída.",
      waitingForInput ? "waiting" : result.failed ? "error" : "success",
    );
    if (waitingForInput) {
      runButton!.disabled = false;
      setStdinVisible(true);
      if (session.inputs.length >= MAX_SESSION_INPUTS) {
        stdinInput!.disabled = true;
        stdinSubmitButton!.disabled = true;
        setExecutionStatus(
          `Limite de ${MAX_SESSION_INPUTS} entradas atingido. Envie EOF para continuar.`,
          "error",
        );
      } else {
        stdinInput!.value = "";
        setExecutionStatus("Aguardando entrada", "waiting");
      }
      return;
    }

    appState.executionSession = null;
    runButton!.disabled = false;
    setStdinVisible(false);
    setExecutionStatus(
      result.failed
        ? (result.statusDescription ?? "Erro na execução")
        : "Programa executado com sucesso",
      result.failed ? "error" : "success",
    );
  } catch (error) {
    if (appState.executionSession !== session) return;
    const message = error instanceof Error ? error.message : "Falha desconhecida ao executar.";
    appState.executionSession = null;
    runButton!.disabled = false;
    setStdinVisible(false);
    setOutput(message, "error");
    setExecutionStatus("Erro na execução", "error");
  } finally {
    if (appState.activeRunController === controller) appState.activeRunController = null;
    if (appState.executionSession === session) setStdinVisible(!stdinForm!.hidden);
  }
}

function startExecutionSession(): void {
  appState.activeRunController?.abort();
  const session: ExecutionSession = {
    sourceCode: editor.value,
    seed: createSessionSeed(),
    inputs: [],
    lastStdout: "",
  };
  appState.executionSession = session;
  stdinInput!.value = "";
  setOutput("Executando...", "waiting");
  runButton!.disabled = true;
  setStdinVisible(false);
  void executeSession(session);
}

function submitSessionInput(sendEof = false): void {
  const session = appState.executionSession;
  if (!session || appState.activeRunController) return;

  const input = stdinInput!.value;
  if (!sendEof && session.inputs.length >= MAX_SESSION_INPUTS) {
    stdinInput!.disabled = true;
    stdinSubmitButton!.disabled = true;
    setExecutionStatus(
      `Limite de ${MAX_SESSION_INPUTS} entradas atingido. Envie EOF para continuar.`,
      "error",
    );
    return;
  }
  if (sendEof && input && session.inputs.length >= MAX_SESSION_INPUTS) {
    setExecutionStatus(
      `Limite de ${MAX_SESSION_INPUTS} entradas atingido. Apague a entrada ou envie EOF.`,
      "error",
    );
    return;
  }

  if (input || !sendEof) {
    session.inputs.push({
      text: input,
      stdoutOffset: session.lastStdout.length,
    });
  }
  stdinInput!.value = "";
  setStdinVisible(true, true);
  void executeSession(session, sendEof);
}

async function copyEditorCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(editor.value);
    showToast("Código copiado.");
  } catch (error) {
    console.error("Não foi possível copiar o código:", error);
    showToast("Não foi possível acessar a área de transferência.");
  }
}

function closeNameModal(): void {
  nameModal!.hidden = true;
  nameError!.textContent = "";
}

function openNameModal(): void {
  nameInput!.value = userName!.textContent ?? "";
  nameError!.textContent = "";
  nameModal!.hidden = false;
  nameInput!.focus();
  nameInput!.select();
}

function stopExecution(): void {
  const session = appState.executionSession;
  appState.executionSession = null;
  appState.activeRunController?.abort();
  appState.activeRunController = null;
  runButton!.disabled = false;
  setStdinVisible(false);
  setExecutionStatus("Execução interrompida", "error");
  if (session) {
    setOutput("Execução interrompida.", "error");
    showToast("Execução interrompida.");
  }
}

copyButton!.addEventListener("click", () => void copyEditorCode());
runButton!.addEventListener("click", startExecutionSession);
stdinForm!.addEventListener("submit", (event) => {
  event.preventDefault();
  submitSessionInput();
});
stdinEofButton!.addEventListener("click", () => submitSessionInput(true));
stopButton!.addEventListener("click", stopExecution);

userIdentity!.addEventListener("click", openNameModal);
cancelNameButton!.addEventListener("click", closeNameModal);
nameModal!.addEventListener("click", (event) => {
  if (event.target === nameModal) closeNameModal();
});
nameForm!.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextName = nameInput!.value.trim();
  if (!nextName) {
    nameError!.textContent = "Digite um nome para continuar.";
    nameInput!.focus();
    return;
  }
  updateUserIdentity(nextName);
  closeNameModal();
  showToast("Nome atualizado.");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !nameModal!.hidden) {
    closeNameModal();
    return;
  }
  if (event.key === "Escape" && !roomDialog!.open) {
    stopButton!.click();
    return;
  }
  if (roomDialog!.open || !nameModal!.hidden) return;

  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runButton!.click();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "c"
  ) {
    event.preventDefault();
    void copyEditorCode();
  }
});

updateUserIdentity(
  getSavedUserName() === "João Developer"
    ? "Usuario"
    : getSavedUserName() ?? "Usuario",
);
