import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import { Pool } from "pg";
import * as Y from "yjs";
import { createYjsDatabaseExtensions } from "./persistence.js";

const databaseUrl = process.env.DATABASE_URL;

function startServer(pool: Pool): Server {
  return new Server({
    port: 0,
    address: "127.0.0.1",
    quiet: true,
    stopOnSignals: false,
    debounce: 50,
    maxDebounce: 200,
    extensions: createYjsDatabaseExtensions(pool),
  });
}

function waitForSynced(provider: HocuspocusProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      provider.off("synced", onSynced);
      reject(new Error("O cliente não sincronizou com o servidor de teste."));
    }, 5_000);
    const onSynced = ({ state }: { state: boolean }) => {
      if (!state) return;
      clearTimeout(timeout);
      provider.off("synced", onSynced);
      resolve();
    };
    provider.on("synced", onSynced);
  });
}

function waitForPersistence(provider: HocuspocusProvider): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      provider.off("stateless", onStateless);
      reject(new Error("O PostgreSQL não confirmou a persistência."));
    }, 5_000);
    const onStateless = ({ payload }: { payload: string }) => {
      let message: unknown;
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "persistence-error") {
        clearTimeout(timeout);
        provider.off("stateless", onStateless);
        reject(new Error("O servidor comunicou uma falha de persistência."));
      }
      if (
        message.type === "persisted" &&
        "stateHash" in message &&
        typeof message.stateHash === "string"
      ) {
        clearTimeout(timeout);
        provider.off("stateless", onStateless);
        resolve(message.stateHash);
      }
    };
    provider.on("stateless", onStateless);
  });
}

test(
  "persists a Yjs document in PostgreSQL and reloads it after server restart",
  { skip: !databaseUrl ? "Configure DATABASE_URL para executar o teste PostgreSQL." : false },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const documentName = `console-room-${randomUUID().slice(0, 8).toUpperCase()}`;
    let server: Server | undefined;
    let provider: HocuspocusProvider | undefined;
    let document: Y.Doc | undefined;

    try {
      const migration = await readFile(
        new URL("./migrations/001_yjs_documents.sql", import.meta.url),
        "utf8",
      );
      await pool.query(migration);

      server = startServer(pool);
      await server.listen();
      document = new Y.Doc();
      provider = new HocuspocusProvider({
        url: `ws://127.0.0.1:${server.address.port}`,
        name: documentName,
        document,
      });
      await waitForSynced(provider);

      const persisted = waitForPersistence(provider);
      document.getText("console-file-personal:integration").insert(0, "persisted Yjs state");
      const stateHash = await persisted;
      assert.equal(
        stateHash,
        createHash("sha256").update(Y.encodeStateAsUpdate(document)).digest("hex"),
      );

      provider.destroy();
      provider = undefined;
      await server.destroy();
      server = undefined;
      document.destroy();
      document = undefined;

      server = startServer(pool);
      await server.listen();
      document = new Y.Doc();
      provider = new HocuspocusProvider({
        url: `ws://127.0.0.1:${server.address.port}`,
        name: documentName,
        document,
      });
      await waitForSynced(provider);

      assert.equal(
        document.getText("console-file-personal:integration").toString(),
        "persisted Yjs state",
      );
    } finally {
      provider?.destroy();
      document?.destroy();
      if (server) await server.destroy();
      await pool.query("DELETE FROM yjs_documents WHERE document_name = $1", [documentName]);
      await pool.end();
    }
  },
);
