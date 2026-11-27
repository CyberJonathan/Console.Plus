import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cert, deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { Server as HocuspocusServer } from "@hocuspocus/server";
import { Pool } from "pg";
import { authorizeRoomDocument } from "./authorization.js";
import { createYjsDatabaseExtensions } from "./persistence.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function parseServiceAccount(rawValue: string): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch (error) {
    throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON não contém JSON válido.", {
      cause: error,
    });
  }

  if (!value || typeof value !== "object") {
    throw new Error("A credencial Firebase Admin precisa ser um objeto JSON.");
  }

  const account = value as Record<string, unknown>;
  const projectId = account.project_id;
  const clientEmail = account.client_email;
  const privateKey = account.private_key;
  if (
    typeof projectId !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string"
  ) {
    throw new Error("A credencial Firebase Admin está incompleta.");
  }

  return { projectId, clientEmail, privateKey };
}

function getAllowedOrigins(): Set<string> {
  const origins = requiredEnvironment("HOCUSPOCUS_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch (error) {
      throw new Error(`Origem inválida em HOCUSPOCUS_ALLOWED_ORIGINS: ${origin}`, {
        cause: error,
      });
    }
    if (parsedOrigin.origin !== origin || !["http:", "https:"].includes(parsedOrigin.protocol)) {
      throw new Error(`Origem inválida em HOCUSPOCUS_ALLOWED_ORIGINS: ${origin}`);
    }
  }
  if (origins.length === 0) {
    throw new Error("HOCUSPOCUS_ALLOWED_ORIGINS precisa conter ao menos uma origem.");
  }
  return new Set(origins);
}

function createFirebaseAdminApp() {
  const projectId = requiredEnvironment("FIREBASE_PROJECT_ID");
  const databaseURL = requiredEnvironment("FIREBASE_DATABASE_URL");
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim();

  if (!serviceAccountJson) {
    throw new Error(
      "Defina FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON com uma credencial Firebase Admin.",
    );
  }

  const serviceAccount = parseServiceAccount(serviceAccountJson);
  if (serviceAccount.projectId !== projectId) {
    throw new Error("FIREBASE_PROJECT_ID não corresponde à credencial Firebase Admin.");
  }

  const existingApp = getApps().find((app) => app.name === "console-plus-hocuspocus");
  return existingApp ?? initializeApp(
    {
      credential: cert(serviceAccount),
      databaseURL,
      projectId,
    },
    "console-plus-hocuspocus",
  );
}

export async function startCollaborationServer(): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const projectId = requiredEnvironment("FIREBASE_PROJECT_ID");
  const origins = getAllowedOrigins();
  const firebaseApp = createFirebaseAdminApp();
  const firebaseAuth = getAuth(firebaseApp);
  const firebaseDatabase = getDatabase(firebaseApp);
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", (error) => {
    console.error("Erro inesperado no pool PostgreSQL do Hocuspocus:", error);
  });

  let hocuspocus: HocuspocusServer | undefined;
  try {
    await pool.query("SELECT 1");
    const migration = await readFile(
      new URL("./migrations/001_yjs_documents.sql", import.meta.url),
      "utf8",
    );
    await pool.query(migration);

    const authorize = async (
      token: string,
      documentName: string,
      originHeader: string | string[] | undefined,
    ) => {
      const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      if (!origin || !origins.has(origin)) {
        throw new Error("Origem não autorizada.");
      }

      return authorizeRoomDocument(token, documentName, {
        verifyIdToken: async (idToken) => {
          const decoded = await firebaseAuth.verifyIdToken(idToken, true);
          return { uid: decoded.uid };
        },
        isRoomMember: async (roomCode, uid) => {
          const snapshot = await firebaseDatabase
            .ref(`rooms/${roomCode}/members/${uid}`)
            .once("value");
          return snapshot.exists();
        },
      });
    };

    hocuspocus = new HocuspocusServer(
      {
        name: "console-plus-collaboration",
        port: Number(process.env.HOCUSPOCUS_PORT ?? process.env.PORT ?? 3002),
        address: process.env.HOST ?? "0.0.0.0",
        quiet: true,
        stopOnSignals: false,
        debounce: 750,
        maxDebounce: 3_000,
        unloadImmediately: false,
        extensions: createYjsDatabaseExtensions(pool),
        async onAuthenticate({ token, documentName, requestHeaders }) {
          const authorized = await authorize(token, documentName, requestHeaders.origin);
          return {
            uid: authorized.uid,
            roomCode: authorized.roomCode,
            projectId,
          };
        },
        async onTokenSync({ token, documentName, requestHeaders }) {
          const authorized = await authorize(token, documentName, requestHeaders.origin);
          return {
            uid: authorized.uid,
            roomCode: authorized.roomCode,
            projectId,
          };
        },
        async onDisconnect({ context, documentName }) {
          console.info(
            `Hocuspocus desconectou ${context?.uid ?? "usuário"} do documento ${documentName}.`,
          );
        },
      },
      { maxPayload: 1024 * 1024, perMessageDeflate: false },
    );

    const startupError = new Promise<never>((_resolve, reject) => {
      hocuspocus!.httpServer.once("error", reject);
    });
    await Promise.race([hocuspocus.listen(), startupError]);
    console.info(`Hocuspocus ouvindo na porta ${hocuspocus.address.port}.`);

    let closing: Promise<void> | undefined;
    return {
      port: hocuspocus.address.port,
      close: () => {
        closing ??= (async () => {
          try {
            await hocuspocus!.destroy();
          } finally {
            await pool.end();
            await deleteApp(firebaseApp);
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    if (hocuspocus) {
      await hocuspocus.destroy().catch((shutdownError: unknown) => {
        console.error("Falha ao encerrar o Hocuspocus após erro de inicialização:", shutdownError);
      });
    }
    await pool.end();
    await deleteApp(firebaseApp);
    throw error;
  }
}

async function main(): Promise<void> {
  if (process.env.HOCUSPOCUS_ENABLED !== "true") {
    console.info("Hocuspocus desativado; defina HOCUSPOCUS_ENABLED=true para iniciá-lo.");
    return;
  }

  const server = await startCollaborationServer();
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.info(`Encerrando Hocuspocus após ${signal}.`);
    try {
      await server.close();
    } catch (error) {
      console.error("Falha ao encerrar o servidor colaborativo:", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  void main().catch((error: unknown) => {
    console.error("Não foi possível iniciar o servidor Hocuspocus:", error);
    process.exitCode = 1;
  });
}
