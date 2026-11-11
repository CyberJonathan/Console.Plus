import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  type Database,
  update,
} from "firebase/database";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";

const MAX_ROOM_MEMBERS = 8;
const MEMBER_HEARTBEAT_INTERVAL_MS = 15_000;
const MEMBER_STALE_AFTER_MS = 120_000;
const COLLABORATION_SYNC_TIMEOUT_MS = 20_000;
const editor = document.querySelector<HTMLTextAreaElement>("#codeEditor");
const usersButton = document.querySelector<HTMLButtonElement>("#usersButton");
const inviteUsersButton = document.querySelector<HTMLButtonElement>("#inviteUsersButton");
const leaveRoomButton = document.querySelector<HTMLButtonElement>("#leaveRoomButton");
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
const toastParent = toast?.parentElement;
const toastNextSibling = toast?.nextSibling;
const copyRoomCodeButton = document.querySelector<HTMLButtonElement>("#copyRoomCodeButton");
const closeRoomDialog = document.querySelector<HTMLButtonElement>("#closeRoomDialog");
const joinRoomForm = document.querySelector<HTMLFormElement>("#joinRoomForm");
const otherRoomCode = document.querySelector<HTMLInputElement>("#otherRoomCode");
const starterCode = `#include <stdio.h>

int main() {
  printf("Olá, mundo!\\n");
  return 0;
}`;

if (
  !editor || !usersButton || !inviteUsersButton || !leaveRoomButton || !toast || !membersPanel || !membersList ||
  !tabs || !personalFileLoader || !personalFileLoaderMessage || !personalFileLoaderRetry ||
  !roomDialog || !currentRoomCode || !copyRoomCodeButton || !closeRoomDialog ||
  !joinRoomForm || !otherRoomCode
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

let toastTimeout: number | undefined;

function showToast(message: string): void {
  if (roomDialog?.open) {
    roomDialog.append(toast!);
  } else if (toastParent && toast!.parentElement !== toastParent) {
    toastParent.insertBefore(
      toast!,
      toastNextSibling?.parentNode === toastParent ? toastNextSibling : null,
    );
  }
  toast!.textContent = message;
  toast!.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast!.classList.remove("visible");
    toastTimeout = undefined;
  }, 3000);
}

function createRoomCode(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

let roomWasGenerated = false;

function getRoomCode(): string {
  const search = new URLSearchParams(location.search);
  const room = search.get("room");
  roomWasGenerated = search.get("generated") === "1";
  if (room && /^[A-Z0-9]{4,12}$/i.test(room)) return room.toUpperCase();

  const code = createRoomCode();
  roomWasGenerated = true;
  search.set("room", code);
  search.set("generated", "1");
  history.replaceState(null, "", `${location.pathname}?${search}`);
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

function updateLeaveRoomButton(): void {
  const userId = getLocalUserId();
  const hasOtherMembers = Object.keys(roomMembers).some((memberId) => memberId !== userId);
  leaveRoomButton!.hidden = soloMode || !roomJoined || !hasOtherMembers;
}

function getLocalUserId(): string | null {
  if (soloMode) return soloUserId;
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
  const fileKeys = Object.keys(members)
    .map((userId) => `personal:${userId}`)
    .sort((first, second) => {
      const firstIsOwner = first.replace("personal:", "") === roomOwnerId;
      const secondIsOwner = second.replace("personal:", "") === roomOwnerId;
      return Number(secondIsOwner) - Number(firstIsOwner);
    });
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
): Promise<{ cleanup: () => Promise<void>; isOwner: boolean; ownerId: string; members: Record<string, unknown> }> {
  if (!database) throw new Error("Firebase ainda não foi configurado.");
  const activeDatabase: Database = database;
  const roomRef = ref(activeDatabase, `rooms/${roomCode}`);
  const membersRef = ref(activeDatabase, `rooms/${roomCode}/members`);
  const memberRef = ref(activeDatabase, `rooms/${roomCode}/members/${userId}`);
  const connectedRef = ref(activeDatabase, ".info/connected");
  let databaseConnected = navigator.onLine;
  const connectedListener = onValue(connectedRef, (snapshot) => {
    databaseConnected = snapshot.val() === true;
  });
  let latestMembers: Record<string, unknown> = {};
  const legacyMemberSeenAt = new Map<string, number>();

  function isStaleMember(memberId: string, member: unknown): boolean {
    if (memberId === userId || !member || typeof member !== "object") return false;
    const lastSeen = "lastSeen" in member ? member.lastSeen : undefined;
    if (typeof lastSeen === "number") {
      legacyMemberSeenAt.delete(memberId);
      return Date.now() - lastSeen > MEMBER_STALE_AFTER_MS;
    }

    const firstSeen = legacyMemberSeenAt.get(memberId) ?? Date.now();
    legacyMemberSeenAt.set(memberId, firstSeen);
    return Date.now() - firstSeen > MEMBER_STALE_AFTER_MS;
  }

  function pruneInactiveMembers(members: Record<string, unknown>): void {
    if (!databaseConnected || !navigator.onLine) return;
    for (const [memberId, member] of Object.entries(members)) {
      if (!isStaleMember(memberId, member)) continue;
      const staleSince = legacyMemberSeenAt.get(memberId);
      void runTransaction(ref(activeDatabase, `rooms/${roomCode}/members/${memberId}`), (current) => {
        if (!current || typeof current !== "object") return;
        const lastSeen = "lastSeen" in current ? current.lastSeen : undefined;
        const stillStale = typeof lastSeen === "number"
          ? Date.now() - lastSeen > MEMBER_STALE_AFTER_MS
          : staleSince !== undefined && Date.now() - staleSince > MEMBER_STALE_AFTER_MS;
        return stillStale ? null : undefined;
      }).catch((error: unknown) => {
        console.error(`Não foi possível limpar a presença expirada de ${memberId}:`, error);
      });
    }
  }

  const membersListener = onValue(membersRef, (snapshot) => {
    const nextMembers = snapshot.val() ?? {};
    if (Object.keys(roomMembers).length > 0 && (!navigator.onLine || !databaseConnected)) {
      renderMembers(roomMembers);
      renderTabs(roomMembers, activeFileKey, selectFile);
      return;
    }
    pruneInactiveMembers(nextMembers);
    latestMembers = nextMembers;
    roomMembers = latestMembers;
    updateLeaveRoomButton();
    try {
      localStorage.setItem(`console-room-members:${roomCode}`, JSON.stringify(roomMembers));
    } catch (error) {
      console.error("Não foi possível atualizar o cache da sala:", error);
    }
    renderMembers(latestMembers);
    renderTabs(roomMembers, activeFileKey, selectFile);
    finishCollaborationSetup();
    updateRoomOnlineStatus();
  });
  let heartbeatTimer: number | undefined;
  try {
    const result = await runTransaction(roomRef, (room) => {
      const members = { ...(room?.members ?? {}) };
      for (const [memberId, member] of Object.entries(members)) {
        if (isStaleMember(memberId, member)) delete members[memberId];
      }
      const memberCount = Object.keys(members).length;
      if (memberCount >= MAX_ROOM_MEMBERS && !members[userId]) return null;

      return {
        createdAt: room?.createdAt ?? serverTimestamp(),
        ownerId: room?.ownerId && members[room.ownerId] ? room.ownerId : userId,
        members: { ...members, [userId]: { name: getUserName() } },
        maxMembers: MAX_ROOM_MEMBERS,
      };
    });

    if (!result.committed) {
      throw new Error(`Esta sala já está cheia. O limite é de ${MAX_ROOM_MEMBERS} pessoas.`);
    }

    await onDisconnect(memberRef).remove();
    await set(memberRef, { name: getUserName(), lastSeen: serverTimestamp() });
    let heartbeatFailureReported = false;
    heartbeatTimer = window.setInterval(() => {
      if (!databaseConnected || !navigator.onLine) return;
      void update(memberRef, { name: getUserName(), lastSeen: serverTimestamp() }).catch((error: unknown) => {
        console.error("Não foi possível atualizar a presença na sala:", error);
        if (!heartbeatFailureReported) {
          heartbeatFailureReported = true;
          showToast("A presença da sala não está sendo atualizada. Verifique a conexão.");
        }
      });
    }, MEMBER_HEARTBEAT_INTERVAL_MS);
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
      cleanup: async () => {
        if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
        membersListener();
        connectedListener();
        await remove(memberRef);
      },
    };
  } catch (error) {
    membersListener();
    connectedListener();
    throw error;
  }
}

const roomCode = getRoomCode();
const soloMode = new URLSearchParams(location.search).get("solo") === "1";
let soloUserId: string | null = null;
if (soloMode) {
  const soloUserKey = `console-solo-user:${roomCode}`;
  soloUserId = localStorage.getItem(soloUserKey);
  if (!soloUserId) {
    soloUserId = `solo-${crypto.randomUUID()}`;
    localStorage.setItem(soloUserKey, soloUserId);
  }
}
const ydoc = new Y.Doc();
const localPersistence = new IndexeddbPersistence(`console-room-${roomCode}`, ydoc);
const configuredSignalingUrl = import.meta.env.VITE_YJS_SIGNALING_URL;
const defaultSignalingUrls = ["wss://y-webrtc-eu.fly.dev", "wss://y-webrtc-us.fly.dev"];
const signalingUrls = !configuredSignalingUrl ||
    configuredSignalingUrl === defaultSignalingUrls[0] ||
    configuredSignalingUrl === "wss://signaling.yjs.dev" ||
    configuredSignalingUrl === "wss://signaling.yjs.dev/"
  ? defaultSignalingUrls
  : [configuredSignalingUrl];
const provider = new WebrtcProvider(`console-room-${roomCode}`, ydoc, {
  signaling: signalingUrls,
});
let activeFileKey = "main.c";
let activeText: Y.Text | null = null;
let applyingRemoteChange = false;
let collaborationReady = false;
let roomJoined = false;
let roomCleanup: (() => Promise<void>) | undefined;
let providerSynced = false;
let providerReportedSynced = false;
let remoteWebrtcPeerCount = 0;
const knownWebrtcPeers = new Set<string>();
let roomOnline = false;
let syncWaitTimeout: number | undefined;
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
const cachedUserId = soloMode ? soloUserId : localStorage.getItem(`console-room-user:${roomCode}`);
let roomOwnerId = soloMode ? soloUserId : localStorage.getItem(`console-room-owner:${roomCode}`);
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
  if (syncWaitTimeout !== undefined) {
    window.clearTimeout(syncWaitTimeout);
    syncWaitTimeout = undefined;
  }

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
  updateRoomOnlineStatus();
  if (!roomOnline) {
    showToast(localOnlyFallback || !navigator.onLine
      ? "Sessão solo disponível offline."
      : "Sessão solo pronta. Compartilhe o código para colaborar.");
  }
}

function updateRoomOnlineStatus(): void {
  const userId = getLocalUserId();
  const hasOtherRoomMembers = Object.keys(roomMembers).some((memberId) => memberId !== userId);
  if (!hasOtherRoomMembers || !providerSynced || !navigator.onLine || localOnlyFallback) {
    if (roomOnline && (!hasOtherRoomMembers || !providerSynced || !navigator.onLine)) {
      roomOnline = false;
      showToast("A sala ficou offline. As alterações serão sincronizadas ao reconectar.");
    }
    return;
  }

  if (!roomOnline) {
    roomOnline = true;
    showToast(`Sala ${roomCode} sincronizada.`);
  }
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
  const currentPeers = new Set(webrtcPeers);
  const hasNewPeer = [...currentPeers].some((peerId) => !knownWebrtcPeers.has(peerId));
  if (hasNewPeer) {
    // y-webrtc keeps its room-level synced flag after peers leave; reset it for this new handshake.
    providerReportedSynced = false;
    providerSynced = false;
    if (provider.room) provider.room.synced = false;
  }
  knownWebrtcPeers.clear();
  currentPeers.forEach((peerId) => knownWebrtcPeers.add(peerId));
  remoteWebrtcPeerCount = webrtcPeers.length;
  providerSynced = providerReportedSynced && remoteWebrtcPeerCount > 0;
  renderTabs(roomMembers, activeFileKey, selectFile);
  if (providerSynced) finishCollaborationSetup();
  updateRoomOnlineStatus();
});
provider.on("status", ({ connected }: { connected: boolean }) => {
  if (!connected && roomOnline) {
    roomOnline = false;
    showToast("Sem conexão com a sala. As alterações ficam salvas neste navegador e serão sincronizadas ao reconectar.");
    renderTabs(roomMembers, activeFileKey, selectFile);
  }
});
provider.on("synced", ({ synced }: { synced: boolean }) => {
  providerReportedSynced = synced;
  providerSynced = providerReportedSynced && remoteWebrtcPeerCount > 0;
  renderTabs(roomMembers, activeFileKey, selectFile);
  if (providerSynced) {
    finishCollaborationSetup();
  } else if (!synced && roomJoined && !collaborationReady) {
    setPersonalFileError(
      "A sincronização do arquivo pessoal foi interrompida. Clique na aba para tentar novamente.",
    );
  }
  updateRoomOnlineStatus();
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
  providerReportedSynced = false;
  updateRoomOnlineStatus();
  showToast("Você está offline. O código permanece salvo neste navegador.");
  if (!collaborationReady) finishCollaborationSetup();
  if (!collaborationReady && !soloMode) {
    setPersonalFileError("Sem conexão. O arquivo pessoal ainda não está disponível.");
  } else if (collaborationReady) {
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
  roomDialog!.showModal();
}

async function copyRoomCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(roomCode);
    showToast(`Código ${roomCode} copiado.`);
  } catch (error) {
    console.error("Não foi possível copiar o código da sala:", error);
    showToast("Não foi possível copiar automaticamente. Selecione o código para copiá-lo.");
    currentRoomCode!.select();
  }
}

usersButton!.addEventListener("click", () => {
  membersPanel!.hidden = !membersPanel!.hidden;
});
inviteUsersButton!.addEventListener("click", openRoomDialog);
leaveRoomButton!.addEventListener("click", () => {
  void leaveRoomForSolo();
});
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
    showToast("Digite um código de sala válido (4 a 12 letras ou números).");
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

async function leaveRoomForSolo(): Promise<void> {
  leaveRoomButton!.disabled = true;
  try {
    if (roomCleanup) {
      await roomCleanup();
      roomCleanup = undefined;
    }

    provider.disconnect();
    const soloUrl = new URL(location.href);
    soloUrl.searchParams.set("room", createRoomCode());
    soloUrl.searchParams.set("solo", "1");
    soloUrl.searchParams.delete("generated");
    location.assign(soloUrl);
  } catch (error) {
    console.error("Não foi possível sair da sala:", error);
    leaveRoomButton!.disabled = false;
    showToast("Não foi possível sair da sala. Tente novamente.");
  }
}

async function prepareGeneratedRoom(userId: string): Promise<boolean> {
  if (!database || !roomWasGenerated) return false;
  const currentRoomRef = ref(database, `users/${userId}/currentRoom`);
  const currentRoomSnapshot = await get(currentRoomRef);
  const previousRoomCode = currentRoomSnapshot.val();
  if (
    typeof previousRoomCode !== "string" ||
    !/^[A-Z0-9]{4,12}$/.test(previousRoomCode) ||
    previousRoomCode === roomCode
  ) return false;

  const previousRoomRef = ref(database, `rooms/${previousRoomCode}`);
  const cleanupResult = await runTransaction(previousRoomRef, (previousRoom) => {
    if (!previousRoom || previousRoom.ownerId !== userId) return;
    const members = previousRoom.members ?? {};
    if (Object.keys(members).some((memberId) => memberId !== userId)) return;
    return null;
  });
  if (cleanupResult.committed) return false;

  const previousRoom = cleanupResult.snapshot.val() as {
    ownerId?: unknown;
    members?: Record<string, unknown>;
  } | null;
  if (previousRoom?.ownerId !== userId) return false;
  const otherMembers = Object.keys(previousRoom.members ?? {}).filter(
    (memberId) => memberId !== userId,
  );
  if (otherMembers.length > 0) {
    const url = new URL(location.href);
    url.searchParams.set("room", previousRoomCode);
    url.searchParams.delete("generated");
    location.replace(url);
    return true;
  }

  await remove(previousRoomRef);
  return false;
}

async function authenticateAndJoin(): Promise<void> {
  localOnlyFallback = false;
  if (soloMode) {
    provider.disconnect();
    localOnlyFallback = true;
    isRoomOwner = true;
    roomMembers = {};
    usersButton!.hidden = true;
    inviteUsersButton!.hidden = true;
    leaveRoomButton!.hidden = true;
    renderTabs(roomMembers, activeFileKey, selectFile);
    finishCollaborationSetup();
    return;
  }
  if (!firebaseApp) {
    usersButton!.textContent = "Sala indisponível";
    setPersonalFileError("Firebase ainda não configurado. Crie o arquivo .env.local.");
    return;
  }

  const auth = getAuth(firebaseApp);
  try {
    const { user } = await signInAnonymously(auth);
    if (await prepareGeneratedRoom(user.uid)) return;
    usersButton!.textContent = `Usuários (1/${MAX_ROOM_MEMBERS})`;
    const joinedRoom = await joinRoom(roomCode, user.uid);
    roomCleanup = joinedRoom.cleanup;
    const { isOwner, ownerId, members } = joinedRoom;
    isRoomOwner = isOwner;
    roomOwnerId = ownerId;
    roomMembers = members;
    roomJoined = true;
    localOnlyFallback = false;
    updateLeaveRoomButton();
    if (
      Object.keys(roomMembers).some((memberId) => memberId !== user.uid) &&
      !providerSynced
    ) {
      syncWaitTimeout = window.setTimeout(() => {
        if (!collaborationReady && roomJoined) {
          setPersonalFileError(
            "A sala ainda mostra participantes sem sincronização. Verifique a conexão; presenças inativas serão removidas automaticamente.",
          );
        }
      }, COLLABORATION_SYNC_TIMEOUT_MS);
    }
    cacheRoomState(roomCode, roomMembers, user.uid, ownerId);
    if (isOwner && database) {
      try {
        await set(ref(database, `users/${user.uid}/currentRoom`), roomCode);
      } catch (error) {
        console.error("Não foi possível registrar a sala atual do usuário:", error);
        showToast("A sala foi aberta, mas não foi possível registrar sua sala principal.");
      }
    }
    if (roomWasGenerated) {
      const url = new URL(location.href);
      url.searchParams.delete("generated");
      history.replaceState(null, "", url);
    }
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

if (soloMode) {
  void authenticateAndJoin();
} else if (requiredConfig.some((value) => !value)) {
  usersButton!.textContent = "Sala indisponível";
  setPersonalFileError("Firebase ainda não configurado. Crie o arquivo .env.local.");
} else {
  void authenticateAndJoin();
  window.addEventListener("console:user-name-changed", (event) => {
    const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
    const user = getAuth(firebaseApp!).currentUser;
    if (!database || !user || typeof name !== "string" || !name.trim()) return;
    void update(ref(database, `rooms/${roomCode}/members/${user.uid}`), {
      name: name.trim(),
    }).catch((error: unknown) => {
      console.error("Não foi possível atualizar o nome na sala:", error);
      showToast("Não foi possível atualizar seu nome na lista da sala.");
    });
  });
}

tabs!.querySelector<HTMLButtonElement>(".tab")?.addEventListener("click", () => {
  if (personalFileState === "error") retryPersonalFileLoad();
});
