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
import { WebrtcProvider } from "y-webrtc";

const editor = document.querySelector<HTMLTextAreaElement>("#codeEditor");
const usersButton = document.querySelector<HTMLButtonElement>("#usersButton");
const inviteUsersButton = document.querySelector<HTMLButtonElement>("#inviteUsersButton");
const toast = document.querySelector<HTMLElement>("#toast");
const membersPanel = document.querySelector<HTMLElement>("#membersPanel");
const membersList = document.querySelector<HTMLUListElement>("#membersList");
const tabs = document.querySelector<HTMLElement>(".tabs");

if (!editor || !usersButton || !inviteUsersButton || !toast || !membersPanel || !membersList || !tabs) {
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

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function replaceEditorValue(value: string): void {
  if (editor!.value === value) return;
  editor!.value = value;
  editor!.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderMembers(value: unknown): void {
  const members = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const entries = Object.entries(members);
  usersButton!.textContent = `Usuários (${entries.length}/2)`;
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

function fileLabel(fileKey: string, members: Record<string, unknown>): string {
  if (fileKey === "main.c") return "main.c";
  const userId = fileKey.replace("personal:", "");
  const member = members[userId];
  const name = member && typeof member === "object" && "name" in member
    ? String(member.name)
    : "Usuario";
  return `main-${name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "Usuario"}.c`;
}

function renderTabs(
  members: Record<string, unknown>,
  activeFileKey: string,
  onSelect: (fileKey: string) => void,
): void {
  tabs!.replaceChildren();
  const fileKeys = ["main.c", ...Object.keys(members).map((userId) => `personal:${userId}`)];

  for (const fileKey of fileKeys) {
    const tab = document.createElement("button");
    tab.className = `tab${fileKey === activeFileKey ? " active" : ""}`;
    tab.type = "button";
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
    tab.addEventListener("click", () => onSelect(fileKey));
    tabs!.append(tab);
  }
}

async function joinRoom(
  roomCode: string,
  userId: string,
): Promise<{ cleanup: () => void; isOwner: boolean; members: Record<string, unknown> }> {
  if (!database) throw new Error("Firebase ainda não foi configurado.");
  const roomRef = ref(database, `rooms/${roomCode}`);
  const membersRef = ref(database, `rooms/${roomCode}/members`);
  const memberRef = ref(database, `rooms/${roomCode}/members/${userId}`);
  let latestMembers: Record<string, unknown> = {};
  const membersListener = onValue(membersRef, (snapshot) => {
    latestMembers = snapshot.val() ?? {};
    renderMembers(latestMembers);
    roomMembers = latestMembers;
    renderTabs(roomMembers, activeFileKey, selectFile);
  });
  const result = await runTransaction(roomRef, (room) => {
    const members = room?.members ?? {};
    const memberCount = Object.keys(members).length;
    if (memberCount >= 2 && !members[userId]) return null;

    return {
      createdAt: room?.createdAt ?? serverTimestamp(),
      ownerId: room?.ownerId ?? userId,
      members: { ...members, [userId]: { name: getUserName() } },
      maxMembers: 2,
    };
  });

  if (!result.committed) {
    membersListener();
    throw new Error("Esta sala já está cheia. O beta permite apenas 2 pessoas.");
  }

  await onDisconnect(memberRef).remove();
  await set(memberRef, { name: getUserName() });
  latestMembers = result.snapshot.child("members").val() ?? latestMembers;
  renderMembers(latestMembers);

  return {
    isOwner: result.snapshot.child("ownerId").val() === userId,
    members: latestMembers,
    cleanup: () => {
      membersListener();
      void remove(memberRef);
    },
  };
}

const roomCode = getRoomCode();
const ydoc = new Y.Doc();
const provider = new WebrtcProvider(`console-room-${roomCode}`, ydoc, {
  signaling: ["wss://y-webrtc-eu.fly.dev", "wss://y-webrtc-us.fly.dev"],
});
const files = ydoc.getMap<Y.Text>("files");
let activeFileKey = "main.c";
let activeText: Y.Text | null = null;
let applyingRemoteChange = false;
let collaborationReady = false;
let roomJoined = false;
let providerSynced = false;
let isRoomOwner = false;
let roomMembers: Record<string, unknown> = {};

function getOrCreateFile(fileKey: string): Y.Text {
  const existing = files.get(fileKey);
  if (existing) return existing;
  const created = new Y.Text();
  files.set(fileKey, created);
  return created;
}

function observeActiveFile(text: Y.Text): void {
  activeText?.unobserve(updateEditorFromActiveFile);
  activeText = text;
  activeText.observe(updateEditorFromActiveFile);
}

function updateEditorFromActiveFile(): void {
  const nextValue = activeText?.toString() ?? "";
  if (nextValue === editor!.value) return;
  applyingRemoteChange = true;
  replaceEditorValue(nextValue);
  applyingRemoteChange = false;
}

function selectFile(fileKey: string): void {
  activeFileKey = fileKey;
  const text = getOrCreateFile(fileKey);
  observeActiveFile(text);
  updateEditorFromActiveFile();
  renderTabs(roomMembers, activeFileKey, selectFile);
}

function finishCollaborationSetup(): void {
  if (collaborationReady || !roomJoined || (!isRoomOwner && !providerSynced)) return;
  const sharedFile = getOrCreateFile("main.c");
  if (sharedFile.length === 0 && isRoomOwner) {
    sharedFile.insert(0, editor!.value);
  }
  const personalFile = getOrCreateFile(`personal:${getAuth(firebaseApp!).currentUser?.uid ?? "local"}`);
  if (personalFile.length === 0) {
    personalFile.insert(0, editor!.value);
  }
  selectFile(activeFileKey);
  collaborationReady = true;
  showToast(`Sala ${roomCode} sincronizada.`);
}

editor!.addEventListener("input", () => {
  if (applyingRemoteChange || !collaborationReady || !activeText) return;
  ydoc.transact(() => {
    activeText!.delete(0, activeText!.length);
    activeText!.insert(0, editor!.value);
  });
});

provider.on("status", ({ connected }: { connected: boolean }) => {
  if (!connected) showToast("Colaboração offline.");
});
provider.on("synced", () => {
  providerSynced = true;
  finishCollaborationSetup();
});
window.setTimeout(finishCollaborationSetup, 5000);

async function copyRoomInvite(): Promise<void> {
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${roomCode}`);
  showToast(`Convite da sala ${roomCode} copiado.`);
}

usersButton!.addEventListener("click", () => {
  membersPanel!.hidden = !membersPanel!.hidden;
});
inviteUsersButton!.addEventListener("click", () => void copyRoomInvite());
document.addEventListener("click", (event) => {
  const target = event.target as Node;
  if (!membersPanel!.hidden && !membersPanel!.contains(target) && target !== usersButton) {
    membersPanel!.hidden = true;
  }
});

if (requiredConfig.some((value) => !value)) {
  showToast("Firebase ainda não configurado. Crie o arquivo .env.local.");
} else {
  const auth = getAuth(firebaseApp!);
  void signInAnonymously(auth)
    .then(({ user }) => {
      usersButton!.textContent = "Usuários (1/2)";
      return joinRoom(roomCode, user.uid);
    })
    .then(({ isOwner, members }) => {
      isRoomOwner = isOwner;
      roomMembers = members;
      roomJoined = true;
      renderTabs(roomMembers, activeFileKey, selectFile);
      finishCollaborationSetup();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível entrar na sala.";
      showToast(message);
      usersButton!.textContent = "Sala indisponível";
    });

  window.addEventListener("console:user-name-changed", (event) => {
    const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
    const user = auth.currentUser;
    if (!database || !user || typeof name !== "string" || !name.trim()) return;
    void set(ref(database, `rooms/${roomCode}/members/${user.uid}`), { name: name.trim() });
  });
}
