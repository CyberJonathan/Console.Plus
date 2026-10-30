const starterCode = `#include <stdio.h>

int main() {
    printf("Olá, mundo!\\n");
    return 0;
}`;

const editor = document.querySelector("#codeEditor");
const lineNumbers = document.querySelector("#lineNumbers");
const cursorPosition = document.querySelector("#cursorPosition");
const runButton = document.querySelector("#runButton");
const terminalOutput = document.querySelector("#terminalOutput");
const runStatus = document.querySelector("#runStatus");
const toast = document.querySelector("#toast");
const inviteDialog = document.querySelector("#inviteDialog");
const inviteForm = document.querySelector("#inviteForm");
const inviteEmail = document.querySelector("#inviteEmail");
const inviteFeedback = document.querySelector("#inviteFeedback");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatMessages = document.querySelector("#chatMessages");
const messageCount = document.querySelector("#messageCount");

let toastTimeout;
let collaboratorInvited = false;
let messages = 1;

function updateEditorDetails() {
  const lineCount = editor.value.split("\n").length;
  lineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");

  const beforeCursor = editor.value.slice(0, editor.selectionStart);
  const lines = beforeCursor.split("\n");
  cursorPosition.textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}

function showToast(message) {
  window.clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(editor.value);
    showToast("Código copiado. Cole onde quiser!");
  } catch (error) {
    if (error instanceof Error) {
      showToast("Não foi possível acessar a área de transferência. Selecione e copie o código.");
      return;
    }
    throw error;
  }
}

function openInviteDialog() {
  if (collaboratorInvited) {
    showToast("O workspace já está com 2 de 2 pessoas.");
    return;
  }
  inviteFeedback.textContent = "";
  inviteEmail.value = "";
  inviteDialog.showModal();
  inviteEmail.focus();
}

function inviteCollaborator(email) {
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const displayName = name ? name.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Colaborador";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  collaboratorInvited = true;
  document.querySelector("#collaboratorAvatar").textContent = initials;
  document.querySelector("#collaboratorAvatar").classList.replace("avatar-empty", "avatar-teammate");
  document.querySelector("#collaboratorSmallAvatar").textContent = initials;
  document.querySelector("#collaboratorName").textContent = displayName;
  document.querySelector("#collaboratorStatus").textContent = "Convite enviado";
  document.querySelector("#collaboratorRow").classList.remove("hidden");
  document.querySelector("#collaboratorCount").textContent = "2";
  document.querySelector("#presenceCount").textContent = "2/2";
  document.querySelector("#sidebarInviteButton").classList.add("hidden");
  document.querySelector(".invite-limit").innerHTML = "<span>●</span> Workspace completo · máximo de 2 pessoas";
}

function simulateCompilation() {
  const code = editor.value;
  runStatus.textContent = "Compilando…";
  runButton.disabled = true;
  runButton.querySelector("span").textContent = "Compilando...";
  terminalOutput.replaceChildren();

  window.setTimeout(() => {
    const hasMain = /\bint\s+main\s*\(/.test(code);
    const hasReturn = /\breturn\s+0\s*;/.test(code);

    if (!hasMain) {
      runStatus.textContent = "Erro de compilação";
      terminalOutput.textContent = "Erro: função main não encontrada.";
    } else if (!hasReturn) {
      runStatus.textContent = "Erro de compilação";
      terminalOutput.textContent = "Erro: inclua `return 0;` para finalizar o programa.";
    } else {
      const printMatches = [...code.matchAll(/\bprintf\s*\(\s*"((?:\\.|[^"\\])*)"/g)];
      const output = printMatches
        .map((match) =>
          match[1]
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\"),
        )
        .join("");

      runStatus.textContent = "Execução simulada";
      terminalOutput.textContent = output || "Compilação simulada concluída sem saída.";
    }

    runButton.disabled = false;
    runButton.querySelector("span").textContent = "Compilar e executar";
  }, 350);
}

function addMessage(text) {
  const article = document.createElement("article");
  article.className = "message";
  const heading = document.createElement("div");
  heading.className = "message-heading";
  const author = document.createElement("strong");
  author.textContent = "João Developer";
  const time = document.createElement("time");
  time.textContent = "agora";
  const content = document.createElement("p");
  content.textContent = text;
  heading.append(author, time);
  article.append(heading, content);
  chatMessages.append(article);
  messages += 1;
  messageCount.textContent = String(messages);
  article.scrollIntoView({ block: "nearest" });
}

editor.addEventListener("input", updateEditorDetails);
editor.addEventListener("click", updateEditorDetails);
editor.addEventListener("keyup", updateEditorDetails);
editor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = editor.scrollTop;
});

document.querySelector("#copyButton").addEventListener("click", copyCode);
document.querySelector("#inviteButton").addEventListener("click", openInviteDialog);
document.querySelector("#sidebarInviteButton").addEventListener("click", openInviteDialog);
document.querySelector("#closeDialog").addEventListener("click", () => inviteDialog.close());
runButton.addEventListener("click", simulateCompilation);

document.querySelector("#collaboratorAvatar").addEventListener("click", openInviteDialog);
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (!runButton.disabled) simulateCompilation();
  }
});

inviteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!inviteEmail.reportValidity()) return;
  if (collaboratorInvited) {
    inviteFeedback.textContent = "O workspace já atingiu o limite de 2 pessoas.";
    return;
  }

  inviteCollaborator(inviteEmail.value.trim());
  inviteFeedback.textContent = "Convite enviado! Na versão completa, essa pessoa receberá um link por e-mail.";
  showToast("Convite enviado para a pessoa colaboradora.");
  window.setTimeout(() => inviteDialog.close(), 1500);
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  addMessage(message);
  chatInput.value = "";
  chatInput.focus();
});

try {
  const savedCode = localStorage.getItem("console-demo-code");
  if (savedCode !== null) editor.value = savedCode;
  editor.addEventListener("input", () => localStorage.setItem("console-demo-code", editor.value));
} catch (error) {
  if (error instanceof Error) {
    showToast("Não foi possível salvar o código neste navegador.");
  } else {
    throw error;
  }
}

if (editor.value === "") editor.value = starterCode;
updateEditorDetails();
