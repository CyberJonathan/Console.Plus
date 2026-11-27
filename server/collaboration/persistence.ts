import { createHash } from "node:crypto";
import { Database } from "@hocuspocus/extension-database";
import type { Extension, storePayload } from "@hocuspocus/server";
import type { Pool } from "pg";

export function createYjsDatabaseExtensions(pool: Pool): Extension[] {
  const pendingStateHashes = new Map<string, string>();
  const database = new Database({
    fetch: async ({ documentName }) => {
      try {
        const result = await pool.query<{ state: Buffer }>(
          "SELECT state FROM yjs_documents WHERE document_name = $1",
          [documentName],
        );
        return result.rows[0]?.state ?? null;
      } catch (error) {
        console.error(`Falha ao carregar o documento Yjs ${documentName}:`, error);
        throw error;
      }
    },
    store: async (data: storePayload) => {
      const stateHash = createHash("sha256").update(data.state).digest("hex");
      try {
        await pool.query(
          `INSERT INTO yjs_documents (document_name, state, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (document_name)
           DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
          [data.documentName, data.state],
        );
        pendingStateHashes.set(data.documentName, stateHash);
      } catch (error) {
        data.document.broadcastStateless(
          JSON.stringify({ type: "persistence-error" }),
        );
        console.error(`Falha ao persistir o documento Yjs ${data.documentName}:`, error);
        throw error;
      }
    },
  });

  const persistenceAcknowledgements: Extension = {
    async afterStoreDocument({ document, documentName }) {
      const stateHash = pendingStateHashes.get(documentName);
      if (!stateHash) return;

      pendingStateHashes.delete(documentName);
      document.broadcastStateless(
        JSON.stringify({
          type: "persisted",
          stateHash,
          savedAt: new Date().toISOString(),
        }),
      );
    },
  };

  return [database, persistenceAcknowledgements];
}
