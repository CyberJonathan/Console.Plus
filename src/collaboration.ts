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

if (!editor || !usersButton || !inviteUsersButton || !toast || !membersPanel || !membersList) {
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

function replaceEditorValue(value: string): void {
  if (editor!.value === value) return;
  editor!.value = value;
  editor!.dispatchEvent(new Event("input", { bubbles: true }));
}

function getUserName(): string {
  return document.querySelector<HTMLElement>("#userName")?.textContent?.trim() || "Usuario";
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

async function joinRoom(roomCode: string, userId: string): Promise<{ cleanup: () => void; isOwner: boolean }> {
  if (!database) throw new Error("Firebase ainda não foi configurado.");
  const roomRef = ref(database, `rooms/${roomCode}`);
  const membersRef = ref(database, `rooms/${roomCode}/members`);
  const memberRef = ref(database, `rooms/${roomCode}/members/${userId}`);
  const membersListener = onValue(membersRef, (snapshot) => renderMembers(snapshot.val()));
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
  renderMembers(result.snapshot.child("members").val());

  return {
    isOwner: result.snapshot.child("ownerId").val() === userId,
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
const ytext = ydoc.getText("main.c");
let applyingRemoteChange = false;
let collaborationReady = false;
let isRoomOwner = false;
let roomJoined = false;
let providerSynced = false;

editor!.addEventListener("input", () => {
  if (applyingRemoteChange || !collaborationReady) return;
  ydoc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, editor!.value);
  });
});

ytext.observe(() => {
  const nextValue = ytext.toString();
  if (nextValue === editor!.value) return;
  applyingRemoteChange = true;
  replaceEditorValue(nextValue);
  applyingRemoteChange = false;
});

provider.on("status", ({ connected }: { connected: boolean }) => {
  if (!connected) showToast("Colaboração offline.");
});

function finishCollaborationSetup(): void {
  if (collaborationReady || !roomJoined || (!isRoomOwner && !providerSynced)) return;
  if (ytext.length === 0 && isRoomOwner) {
    ytext.insert(0, editor!.value);
  } else if (ytext.length > 0) {
    replaceEditorValue(ytext.toString());
  }
  collaborationReady = true;
  showToast(`Sala ${roomCode} sincronizada.`);
}

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
    .then(({ isOwner }) => {
      isRoomOwner = isOwner;
      roomJoined = true;
      finishCollaborationSetup();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível entrar na sala.";
      showToast(message);
      usersButton!.textContent = "Sala indisponível";
    });
}

window.addEventListener("console:user-name-changed", (event) => {
  if (!database) return;
  const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
  const user = getAuth(firebaseApp!).currentUser;
  if (!user || typeof name !== "string" || !name.trim()) return;
  void set(ref(database, `rooms/${roomCode}/members/${user.uid}`), { name: name.trim() });
});
