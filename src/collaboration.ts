import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
} from "firebase/database";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";

const MAX_ROOM_MEMBERS = 8;
const editor = document.querySelector<HTMLTextAreaElement>("#codeEditor");
const usersButton = document.querySelector<HTMLButtonElement>("#usersButton");
const inviteUsersButton = document.querySelector<HTMLButtonElement>("#inviteUsersButton");
const toast = document.querySelector<HTMLElement>("#toast");
const membersPanel = document.querySelector<HTMLElement>("#membersPanel");
const membersList = document.querySelector<HTMLUListElement>("#membersList");
const tabs = document.querySelector<HTMLElement>(".tabs");
const personalFileLoader = document.querySelector<HTMLElement>("#personalFileLoader");
const personalFileLoaderMessage = personalFileLoader?.querySelector<HTMLElement>(
  ".personal-file-loader-message",
);
const personalFileLoaderRetry = personalFileLoader?.querySelector<HTMLButtonElement>(
  ".personal-file-loader-retry",
);
const roomDialog = document.querySelector<HTMLDialogElement>("#roomDialog");
const currentRoomCode = document.querySelector<HTMLInputElement>("#currentRoomCode");
const copyRoomCodeButton = document.querySelector<HTMLButtonElement>("#copyRoomCodeButton");
const closeRoomDialog = document.querySelector<HTMLButtonElement>("#closeRoomDialog");
const joinRoomForm = document.querySelector<HTMLFormElement>("#joinRoomForm");
const otherRoomCode = document.querySelector<HTMLInputElement>("#otherRoomCode");
const roomDialogFeedback = document.querySelector<HTMLElement>("#roomDialogFeedback");
const starterCode = `#include <stdio.h>

int main() {
  printf("Olá, mundo!\\n");
  return 0;
}`;

if (
  !editor || !usersButton || !inviteUsersButton || !toast || !membersPanel || !membersList ||
  !tabs || !personalFileLoader || !personalFileLoaderMessage || !personalFileLoaderRetry ||
  !roomDialog || !currentRoomCode || !copyRoomCodeButton || !closeRoomDialog ||
  !joinRoomForm || !otherRoomCode || !roomDialogFeedback
) {
  throw new Error("Elementos necessários para colaboração não foram encontrados.");
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.databaseURL,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];
const firebaseApp = requiredConfig.some((value) => !value) ? null : initializeApp(firebaseConfig);
const database = firebaseApp ? getDatabase(firebaseApp) : null;

function showToast(message: string): void {
  toast!.textContent = message;
  toast!.classList.add("visible");
  window.setTimeout(() => toast!.classList.remove("visible"), 3000);
}

function createRoomCode(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

function getRoomCode(): string {
  const room = new URLSearchParams(location.search).get("room");
  if (room && /^[A-Z0-9]{4,12}$/i.test(room)) return room.toUpperCase();

  const code = createRoomCode();
  history.replaceState(null, "", `${location.pathname}?room=${code}`);
  return code;
}

function getUserName(): string {
  return document.querySelector<HTMLElement>("#userName")?.textContent?.trim() || "Usuario";
}

function replaceEditorValue(value: string): void {
  if (editor!.value === value) return;
  const selectionStart = editor!.selectionStart;
  const selectionEnd = editor!.selectionEnd;
  editor!.value = value;
  editor!.setSelectionRange(
    Math.min(selectionStart, value.length),
    Math.min(selectionEnd, value.length),
  );
  editor!.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateYTextIncrementally(text: Y.Text, previousValue: string, nextValue: string): void {
  let prefixLength = 0;
  while (
    prefixLength < previousValue.length &&
    prefixLength < nextValue.length &&
    previousValue[prefixLength] === nextValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousValue.length - prefixLength &&
    suffixLength < nextValue.length - prefixLength &&
    previousValue[previousValue.length - 1 - suffixLength] ===
      nextValue[nextValue.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const deletedLength = previousValue.length - prefixLength - suffixLength;
  const insertedValue = nextValue.slice(prefixLength, nextValue.length - suffixLength);

  if (deletedLength === 0 && insertedValue.length === 0) return;
  ydoc.transact(() => {
    if (deletedLength > 0) text.delete(prefixLength, deletedLength);
    if (insertedValue.length > 0) text.insert(prefixLength, insertedValue);
  });
}

function renderMembers(value: unknown): void {
  const members = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const entries = Object.entries(members);
  usersButton!.textContent = `Usuários (${entries.length}/${MAX_ROOM_MEMBERS})`;
  usersButton!.hidden = entries.length <= 1;
  membersList!.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "members-empty";
    empty.textContent = "Nenhum usuário online.";
    membersList!.append(empty);
    return;
  }

  for (const [, member] of entries) {
    const name = member && typeof member === "object" && "name" in member
      ? String(member.name)
      : "Usuario";
    const item = document.createElement("li");
    item.className = "member-item";
    const status = document.createElement("span");
    status.className = "member-status";
    status.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = name;
    item.append(status, label);
    membersList!.append(item);
  }
}

function getCachedRoomMembers(roomCode: string): Record<string, unknown> {
  try {
    const cached = localStorage.getItem(`console-room-members:${roomCode}`);
    if (!cached) return {};
    const parsed: unknown = JSON.parse(cached);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch (error) {
    console.error("Não foi possível ler a lista de participantes em cache:", error);
    return {};
  }
}

function cacheRoomState(roomCode: string, members: Record<string, unknown>, userId: string, ownerId: string): void {
  try {
    localStorage.setItem(`console-room-members:${roomCode}`, JSON.stringify(members));
    localStorage.setItem(`console-room-user:${roomCode}`, userId);
    localStorage.setItem(`console-room-owner:${roomCode}`, ownerId);
  } catch (error) {
    console.error("Não foi possível salvar o estado local da sala:", error);
    showToast("Não foi possível manter o cache local da sala neste navegador.");
  }
}

function getLocalUserId(): string | null {
  const firebaseUserId = firebaseApp ? getAuth(firebaseApp).currentUser?.uid : null;
  return firebaseUserId ?? localStorage.getItem(`console-room-user:${roomCode}`);
}

function fileLabel(fileKey: string, members: Record<string, unknown>): string {
  const userId = fileKey.replace("personal:", "");
  const member = members[userId];
  const name = member && typeof member === "object" && "name" in member
    ? String(member.name)
    : "Usuario";
  if (userId === getLocalUserId()) return "main.c";
  return `${name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "Usuario"}.c`;
}

function renderTabs(
  members: Record<string, unknown>,
  activeFileKey: string,
  onSelect: (fileKey: string) => void,
): void {
  const fileKeys = Object.keys(members).map((userId) => `personal:${userId}`);
  if (fileKeys.length === 0) {
    const initialTab = tabs!.querySelector<HTMLButtonElement>(".tab");
    if (initialTab) applyPersonalFileState(initialTab);
    return;
  }
  tabs!.replaceChildren();

  for (const fileKey of fileKeys) {
    const tab = document.createElement("button");
    const userId = fileKey.replace("personal:", "");
    const isOwnerFile = userId === roomOwnerId;
    tab.className = `tab${fileKey === activeFileKey ? " active" : ""}${isOwnerFile ? " room-owner" : ""}`;
    tab.dataset.fileKey = fileKey;
    tab.type = "button";
    if (isOwnerFile) {
      tab.title = "Arquivo do dono da sala";
      tab.setAttribute("aria-label", `${fileLabel(fileKey, members)}, dono da sala`);
    }
    const localFile = userId === getLocalUserId();
    const cachedRemoteFile = getOrCreateFile(fileKey).length > 0;
    tab.disabled = !localFile && !providerSynced && !cachedRemoteFile;
    tab.setAttribute("aria-selected", String(fileKey === activeFileKey));
    const dots = document.createElement("span");
    dots.className = "tab-dots";
    dots.setAttribute("aria-hidden", "true");
    for (const color of ["blue", "red", "yellow"]) {
      const dot = document.createElement("span");
      dot.className = `tab-dot tab-dot-${color}`;
      dots.append(dot);
    }
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = fileLabel(fileKey, members);
    tab.append(dots, name);
    if (localFile) {
      applyPersonalFileState(tab);
    }
    tab.addEventListener("click", () => {
      if (localFile && personalFileState === "error") {
        retryPersonalFileLoad();
        return;
      }
      onSelect(fileKey);
    });
    tabs!.append(tab);
  }
  updateTypingIndicators();
}

async function joinRoom(
  roomCode: string,
  userId: string,
): Promise<{ cleanup: () => void; isOwner: boolean; ownerId: string; members: Record<string, unknown> }> {
  if (!database) throw new Error("Firebase ainda não foi configurado.");
  const roomRef = ref(database, `rooms/${roomCode}`);
  const membersRef = ref(database, `rooms/${roomCode}/members`);
  const memberRef = ref(database, `rooms/${roomCode}/members/${userId}`);
  const connectedRef = ref(database, ".info/connected");
  let databaseConnected = navigator.onLine;
  const connectedListener = onValue(connectedRef, (snapshot) => {
    databaseConnected = snapshot.val() === true;
  });
  let latestMembers: Record<string, unknown> = {};
  const membersListener = onValue(membersRef, (snapshot) => {
    const nextMembers = snapshot.val() ?? {};
    if (Object.keys(roomMembers).length > 0 && (!navigator.onLine || !databaseConnected)) {
      renderMembers(roomMembers);
      renderTabs(roomMembers, activeFileKey, selectFile);
      return;
    }
    latestMembers = nextMembers;
    roomMembers = latestMembers;
    try {
      localStorage.setItem(`console-room-members:${roomCode}`, JSON.stringify(roomMembers));
    } catch (error) {
      console.error("Não foi possível atualizar o cache da sala:", error);
    }
    renderMembers(latestMembers);
    renderTabs(roomMembers, activeFileKey, selectFile);
  });
  try {
    const result = await runTransaction(roomRef, (room) => {
      const members = room?.members ?? {};
      const memberCount = Object.keys(members).length;
      if (memberCount >= MAX_ROOM_MEMBERS && !members[userId]) return null;

      return {
        createdAt: room?.createdAt ?? serverTimestamp(),
        ownerId: room?.ownerId ?? userId,
        members: { ...members, [userId]: { name: getUserName() } },
        maxMembers: MAX_ROOM_MEMBERS,
      };
    });

    if (!result.committed) {
      throw new Error(`Esta sala já está cheia. O limite é de ${MAX_ROOM_MEMBERS} pessoas.`);
    }

    await onDisconnect(memberRef).remove();
    await set(memberRef, { name: getUserName() });
    latestMembers = result.snapshot.child("members").val() ?? latestMembers;
    roomMembers = latestMembers;
    const ownerId = result.snapshot.child("ownerId").val() as string;
    roomOwnerId = ownerId;
    cacheRoomState(
      roomCode,
      roomMembers,
      userId,
      ownerId,
    );
    renderTabs(roomMembers, activeFileKey, selectFile);
    renderMembers(latestMembers);

    return {
      isOwner: ownerId === userId,
      ownerId,
      members: latestMembers,
      cleanup: () => {
        membersListener();
        connectedListener();
        void remove(memberRef);
      },
    };
  } catch (error) {
    membersListener();
    connectedListener();
    throw error;
  }
}

const roomCode = getRoomCode();
const ydoc = new Y.Doc();
const localPersistence = new IndexeddbPersistence(`console-room-${roomCode}`, ydoc);
const signalingUrl = import.meta.env.VITE_YJS_SIGNALING_URL || "wss://signaling.yjs.dev";
const provider = new WebrtcProvider(`console-room-${roomCode}`, ydoc, {
  signaling: [signalingUrl],
});
let activeFileKey = "main.c";
let activeText: Y.Text | null = null;
let applyingRemoteChange = false;
let collaborationReady = false;
let roomJoined = false;
let providerSynced = false;
let remoteWebrtcPeerCount = 0;
let localPersistenceReady = false;
let localPersistenceFailed = false;
let localOnlyFallback = false;
let isRoomOwner = false;
let roomMembers: Record<string, unknown> = getCachedRoomMembers(roomCode);
let personalFileState: "loading" | "ready" | "error" = "loading";
let personalFileError = "";
let lastEditorValue = "";
let typingIdleTimeout: number | undefined;
let localTyping = false;
const cachedUserId = localStorage.getItem(`console-room-user:${roomCode}`);
let roomOwnerId = localStorage.getItem(`console-room-owner:${roomCode}`);
if (cachedUserId) {
  isRoomOwner = roomOwnerId === cachedUserId || roomOwnerId === "true";
  if (roomOwnerId === "true") roomOwnerId = cachedUserId;
  renderMembers(roomMembers);
  renderTabs(roomMembers, activeFileKey, selectFile);
}

function getOrCreateFile(fileKey: string): Y.Text {
  return ydoc.getText(`console-file-${fileKey}`);
}

function applyPersonalFileState(tab: HTMLButtonElement): void {
  const isLoading = personalFileState === "loading";
  const hasError = personalFileState === "error";
  tab.classList.toggle("loading", isLoading);
  tab.classList.toggle("load-error", hasError);
  tab.setAttribute("aria-busy", String(isLoading));

  const errorIndicator = tab.querySelector<HTMLElement>(".tab-load-error");
  if (hasError && !errorIndicator) {
    const indicator = document.createElement("span");
    indicator.className = "tab-load-error";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = "!";
    tab.insertBefore(indicator, tab.querySelector(".tab-name"));
  } else if (!hasError) {
    errorIndicator?.remove();
  }
}

function renderPersonalFileState(): void {
  const isLoading = personalFileState === "loading";
  const hasError = personalFileState === "error";
  personalFileLoader!.hidden = personalFileState === "ready";
  personalFileLoader!.classList.toggle("load-error", hasError);
  personalFileLoaderMessage!.hidden = !hasError;
  personalFileLoaderMessage!.textContent = hasError ? personalFileError : "";
  personalFileLoaderRetry!.hidden = !hasError;
  personalFileLoader!.setAttribute("aria-label", isLoading
    ? "Carregando seu arquivo pessoal"
    : hasError
      ? `Erro ao carregar seu arquivo pessoal: ${personalFileError}`
      : "");
  renderTabs(roomMembers, activeFileKey, selectFile);
  const uid = getLocalUserId();
  const personalTab = uid
    ? tabs!.querySelector<HTMLButtonElement>(`.tab[data-file-key="personal:${uid}"]`)
    : null;
  const tab = personalTab ?? tabs!.querySelector<HTMLButtonElement>(".tab");
  if (tab && !personalTab) applyPersonalFileState(tab);
  const tabLabel = tab?.dataset.fileKey?.startsWith("personal:")
    ? fileLabel(tab.dataset.fileKey, roomMembers)
    : "main.c";
  if (tab && personalFileState === "error") {
    const labels = [tabLabel, personalFileError];
    tab.setAttribute("aria-label", labels.join(", "));
    tab.title = `${personalFileError} Clique para tentar novamente.`;
  } else if (tab && personalFileState === "loading") {
    tab.setAttribute("aria-label", `${tabLabel}, carregando`);
    tab.title = "Aguardando a disponibilidade do arquivo pessoal.";
  }
}

function setPersonalFileError(message: string): void {
  personalFileState = "error";
  personalFileError = message;
  renderPersonalFileState();
  showToast(message);
}

function updateTypingIndicators(): void {
  const typingFileKeys = new Set<string>();
  for (const state of provider.awareness.getStates().values()) {
    const fileKey = state.consolePlusTyping;
    if (typeof fileKey === "string") typingFileKeys.add(fileKey);
  }

  tabs!.querySelectorAll<HTMLButtonElement>(".tab[data-file-key]").forEach((tab) => {
    const fileKey = tab.dataset.fileKey;
    if (!fileKey) return;
    const isOwnerFile = fileKey.replace("personal:", "") === roomOwnerId;
    const isTyping = typingFileKeys.has(fileKey);
    tab.classList.toggle("typing", isTyping);
    const labelParts = [
      fileLabel(fileKey, roomMembers),
      ...(isOwnerFile ? ["dono da sala"] : []),
      ...(isTyping ? ["em edição"] : []),
      ...(fileKey === `personal:${getLocalUserId()}` && personalFileState === "loading"
        ? ["carregando"]
        : []),
      ...(fileKey === `personal:${getLocalUserId()}` && personalFileState === "error"
        ? [personalFileError]
        : []),
    ];
    tab.setAttribute("aria-label", labelParts.join(", "));
    tab.title = [
      ...(isOwnerFile ? ["Arquivo do dono da sala"] : []),
      ...(isTyping ? ["Um participante está editando este arquivo"] : []),
      ...(fileKey === `personal:${getLocalUserId()}` && personalFileState === "loading"
        ? ["Aguardando a disponibilidade do arquivo pessoal"]
        : []),
      ...(fileKey === `personal:${getLocalUserId()}` && personalFileState === "error"
        ? [personalFileError, "Clique para tentar novamente"]
        : []),
    ].join(" · ");
  });
  if (localTyping && activeFileKey === "main.c") {
    tabs!.querySelector(".tab.active")?.classList.add("typing");
  }
}

function stopLocalTyping(): void {
  window.clearTimeout(typingIdleTimeout);
  typingIdleTimeout = undefined;
  localTyping = false;
  if (activeFileKey.startsWith("personal:")) {
    provider.awareness.setLocalStateField("consolePlusTyping", null);
  }
  updateTypingIndicators();
}

function observeActiveFile(text: Y.Text): void {
  activeText?.unobserve(updateEditorFromActiveFile);
  activeText = text;
  lastEditorValue = text.toString();
  activeText.observe(updateEditorFromActiveFile);
}

function updateEditorFromActiveFile(event?: Y.YTextEvent): void {
  const nextValue = activeText?.toString() ?? "";
  if (nextValue === editor!.value) {
    lastEditorValue = nextValue;
    return;
  }

  applyingRemoteChange = true;
  if (event) {
    let editorValue = editor!.value;
    let offset = 0;
    let canApplyDelta = true;

    for (const operation of event.delta) {
      if (typeof operation.retain === "number") {
        offset += operation.retain;
      } else if (typeof operation.delete === "number") {
        editorValue = editorValue.slice(0, offset) + editorValue.slice(offset + operation.delete);
      } else if (typeof operation.insert === "string") {
        editorValue = editorValue.slice(0, offset) + operation.insert + editorValue.slice(offset);
        offset += operation.insert.length;
      } else {
        canApplyDelta = false;
        break;
      }
    }

    replaceEditorValue(canApplyDelta && editorValue === nextValue ? editorValue : nextValue);
  } else {
    replaceEditorValue(nextValue);
  }
  applyingRemoteChange = false;
  lastEditorValue = nextValue;
}

function selectFile(fileKey: string): void {
  activeFileKey = fileKey;
  const text = getOrCreateFile(fileKey);
  observeActiveFile(text);
  updateEditorFromActiveFile();
  renderTabs(roomMembers, activeFileKey, selectFile);
}

function finishCollaborationSetup(): void {
  const userId = getLocalUserId();
  if (
    collaborationReady || (!roomJoined && !localOnlyFallback) ||
    (!localPersistenceReady && !localPersistenceFailed) || !userId
  ) return;
  const personalFile = getOrCreateFile(`personal:${userId}`);

  const hasOtherRoomMembers = Object.keys(roomMembers).some((memberId) => memberId !== userId);
  const hasUsableOfflineCopy = personalFile.length > 0 &&
    (localOnlyFallback || !navigator.onLine) && localPersistenceReady;
  if (!providerSynced && hasOtherRoomMembers && !hasUsableOfflineCopy) return;

  if (personalFile.length === 0) {
    if (!providerSynced && (!navigator.onLine || hasOtherRoomMembers)) {
      setPersonalFileError(
        "Não foi possível sincronizar o arquivo pessoal. Verifique a conexão e clique para tentar novamente.",
      );
      return;
    }
    personalFile.insert(0, isRoomOwner ? editor!.value : starterCode);
  }

  activeFileKey = `personal:${userId}`;
  selectFile(activeFileKey);
  collaborationReady = true;
  personalFileState = "ready";
  personalFileError = "";
  renderPersonalFileState();
  showToast(localOnlyFallback || !navigator.onLine
    ? "Arquivo pessoal aberto em modo offline."
    : `Sala ${roomCode} sincronizada.`);
}

function retryPersonalFileLoad(): void {
  if (!navigator.onLine) {
    setPersonalFileError("Sem conexão. Reconecte-se e clique para tentar novamente.");
    return;
  }

  personalFileState = "loading";
  personalFileError = "";
  renderPersonalFileState();
  if (roomJoined) {
    provider.disconnect();
    provider.connect();
    finishCollaborationSetup();
    return;
  }
  void authenticateAndJoin();
}

personalFileLoaderRetry!.addEventListener("click", retryPersonalFileLoad);

editor!.addEventListener("input", () => {
  if (applyingRemoteChange) return;
  if (collaborationReady && activeText) {
    const nextValue = editor!.value;
    updateYTextIncrementally(activeText, lastEditorValue, nextValue);
    lastEditorValue = nextValue;
    if (activeFileKey.startsWith("personal:")) {
      provider.awareness.setLocalStateField("consolePlusTyping", activeFileKey);
    }
  }
  localTyping = true;
  updateTypingIndicators();
  window.clearTimeout(typingIdleTimeout);
  typingIdleTimeout = window.setTimeout(stopLocalTyping, 1200);
});
editor!.addEventListener("blur", stopLocalTyping);

provider.awareness.on("change", updateTypingIndicators);
provider.on("peers", ({ webrtcPeers }: { webrtcPeers: string[] }) => {
  remoteWebrtcPeerCount = webrtcPeers.length;
  if (remoteWebrtcPeerCount === 0) providerSynced = false;
  renderTabs(roomMembers, activeFileKey, selectFile);
});
provider.on("status", ({ connected }: { connected: boolean }) => {
  if (!connected) {
    showToast("Sem conexão com a sala. As alterações ficam salvas neste navegador e serão sincronizadas ao reconectar.");
    renderTabs(roomMembers, activeFileKey, selectFile);
  }
});
provider.on("synced", ({ synced }: { synced: boolean }) => {
  providerSynced = synced && remoteWebrtcPeerCount > 0;
  renderTabs(roomMembers, activeFileKey, selectFile);
  if (providerSynced) {
    finishCollaborationSetup();
  } else if (!synced && roomJoined && !collaborationReady) {
    setPersonalFileError(
      "A sincronização do arquivo pessoal foi interrompida. Clique na aba para tentar novamente.",
    );
  }
});
void localPersistence.whenSynced.then(() => {
  localPersistenceReady = true;
  renderTabs(roomMembers, activeFileKey, selectFile);
  finishCollaborationSetup();
}).catch((error: unknown) => {
  localPersistenceFailed = true;
  console.error("Falha ao carregar o cache local Yjs:", error);
  if (providerSynced) {
    finishCollaborationSetup();
  } else if (!navigator.onLine) {
    setPersonalFileError("Não foi possível carregar o arquivo offline. Reconecte-se e tente novamente.");
  } else {
    showToast("Não foi possível carregar o cache local. A colaboração tentará continuar online.");
  }
});

window.addEventListener("offline", () => {
  providerSynced = false;
  showToast("Você está offline. O código permanece salvo neste navegador.");
  if (!collaborationReady) finishCollaborationSetup();
  if (!collaborationReady) {
    setPersonalFileError("Sem conexão. O arquivo pessoal ainda não está disponível.");
  } else {
    renderTabs(roomMembers, activeFileKey, selectFile);
  }
});
window.addEventListener("online", () => {
  showToast("Conexão restaurada. Sincronizando a sala...");
  if (personalFileState === "error") retryPersonalFileLoad();
});

function openRoomDialog(): void {
  currentRoomCode!.value = roomCode;
  otherRoomCode!.value = "";
  roomDialogFeedback!.textContent = "";
  roomDialog!.showModal();
}

async function copyRoomCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(roomCode);
    showToast(`Código ${roomCode} copiado.`);
  } catch (error) {
    console.error("Não foi possível copiar o código da sala:", error);
    roomDialogFeedback!.textContent = "Não foi possível copiar automaticamente. Selecione e copie o código.";
    currentRoomCode!.select();
  }
}

usersButton!.addEventListener("click", () => {
  membersPanel!.hidden = !membersPanel!.hidden;
});
inviteUsersButton!.addEventListener("click", openRoomDialog);
copyRoomCodeButton!.addEventListener("click", () => void copyRoomCode());
closeRoomDialog!.addEventListener("click", () => roomDialog!.close());
otherRoomCode!.addEventListener("input", () => {
  const start = otherRoomCode!.selectionStart;
  const end = otherRoomCode!.selectionEnd;
  otherRoomCode!.value = otherRoomCode!.value.toUpperCase();
  otherRoomCode!.setSelectionRange(start, end);
});
roomDialog!.addEventListener("click", (event) => {
  if (event.target === roomDialog) roomDialog!.close();
});
joinRoomForm!.addEventListener("submit", (event) => {
  event.preventDefault();
  const requestedRoom = otherRoomCode!.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(requestedRoom)) {
    roomDialogFeedback!.textContent = "Digite um código de sala válido (4 a 12 letras ou números).";
    return;
  }
  location.assign(`${location.pathname}?room=${requestedRoom}`);
});
document.addEventListener("click", (event) => {
  const target = event.target as Node;
  if (!membersPanel!.hidden && !membersPanel!.contains(target) && target !== usersButton) {
    membersPanel!.hidden = true;
  }
});

async function authenticateAndJoin(): Promise<void> {
  localOnlyFallback = false;
  if (!firebaseApp) {
    usersButton!.textContent = "Sala indisponível";
    setPersonalFileError("Firebase ainda não configurado. Crie o arquivo .env.local.");
    return;
  }

  const auth = getAuth(firebaseApp);
  try {
    const { user } = await signInAnonymously(auth);
    usersButton!.textContent = `Usuários (1/${MAX_ROOM_MEMBERS})`;
    const { isOwner, ownerId, members } = await joinRoom(roomCode, user.uid);
    isRoomOwner = isOwner;
    roomOwnerId = ownerId;
    roomMembers = members;
    roomJoined = true;
    localOnlyFallback = false;
    cacheRoomState(roomCode, roomMembers, user.uid, ownerId);
    renderTabs(roomMembers, activeFileKey, selectFile);
    finishCollaborationSetup();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível entrar na sala.";
    const errorCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if ((!navigator.onLine || /network|unavailable/i.test(errorCode)) && cachedUserId) {
      localOnlyFallback = true;
      isRoomOwner = roomOwnerId === cachedUserId || roomOwnerId === "true";
      if (roomOwnerId === "true") roomOwnerId = cachedUserId;
      renderTabs(roomMembers, activeFileKey, selectFile);
      finishCollaborationSetup();
      if (!collaborationReady) {
        setPersonalFileError("Offline: arquivo pessoal indisponível neste navegador.");
      }
    } else {
      usersButton!.textContent = "Sala indisponível";
      setPersonalFileError(message);
    }
  }
}

if (requiredConfig.some((value) => !value)) {
  usersButton!.textContent = "Sala indisponível";
  setPersonalFileError("Firebase ainda não configurado. Crie o arquivo .env.local.");
} else {
  void authenticateAndJoin();
  window.addEventListener("console:user-name-changed", (event) => {
    const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
    const user = getAuth(firebaseApp!).currentUser;
    if (!database || !user || typeof name !== "string" || !name.trim()) return;
    void set(ref(database, `rooms/${roomCode}/members/${user.uid}`), { name: name.trim() });
  });
}

tabs!.querySelector<HTMLButtonElement>(".tab")?.addEventListener("click", () => {
  if (personalFileState === "error") retryPersonalFileLoad();
});
