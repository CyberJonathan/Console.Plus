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
const toast = document.querySelector<HTMLElement>("#toast");

if (!editor || !usersButton || !toast) {
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

async function joinRoom(roomCode: string, userId: string): Promise<() => void> {
  if (!database) throw new Error("Firebase ainda não foi configurado.");
  const roomRef = ref(database, `rooms/${roomCode}`);
  const memberRef = ref(database, `rooms/${roomCode}/members/${userId}`);
  const result = await runTransaction(roomRef, (room) => {
    const members = room?.members ?? {};
    const memberCount = Object.keys(members).length;

    if (memberCount >= 2 && !members[userId]) return null;

    return {
      createdAt: room?.createdAt ?? serverTimestamp(),
      ownerId: room?.ownerId ?? userId,
      members: { ...members, [userId]: true },
      maxMembers: 2,
    };
  });

  if (!result.committed) {
    throw new Error("Esta sala já está cheia. O beta permite apenas 2 pessoas.");
  }

  await onDisconnect(memberRef).remove();
  await set(memberRef, true);

  const membersListener = onValue(ref(database, `rooms/${roomCode}/members`), (snapshot) => {
    const count = Object.keys(snapshot.val() ?? {}).length;
    usersButton!.textContent = `Usuários (${count}/2)`;
  });

  return () => {
    membersListener();
    void remove(memberRef);
  };
}

const roomCode = getRoomCode();
const ydoc = new Y.Doc();
const provider = new WebrtcProvider(`console-room-${roomCode}`, ydoc, {
  signaling: ["wss://y-webrtc-eu.fly.dev", "wss://y-webrtc-us.fly.dev"],
});
const ytext = ydoc.getText("main.c");
let applyingRemoteChange = false;

if (ytext.length === 0) {
  ytext.insert(0, editor!.value);
} else {
  replaceEditorValue(ytext.toString());
}

editor!.addEventListener("input", () => {
  if (applyingRemoteChange) return;
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
  showToast(connected ? `Sala ${roomCode} sincronizada.` : "Colaboração offline.");
});

usersButton!.addEventListener("click", async () => {
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${roomCode}`);
  showToast(`Convite da sala ${roomCode} copiado.`);
});

if (requiredConfig.some((value) => !value)) {
  showToast("Firebase ainda não configurado. Crie o arquivo .env.local.");
} else {
  const auth = getAuth(firebaseApp!);

  void signInAnonymously(auth)
    .then(({ user }) => joinRoom(roomCode, user.uid))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Não foi possível entrar na sala.";
      showToast(message);
      usersButton!.textContent = "Sala indisponível";
    });
}
