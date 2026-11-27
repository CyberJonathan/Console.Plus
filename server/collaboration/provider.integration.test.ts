import assert from "node:assert/strict";
import { test } from "node:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";

function waitForSynced(provider: HocuspocusProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      provider.off("synced", onSynced);
      reject(new Error("Hocuspocus não sincronizou dentro do tempo limite."));
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

async function waitForValue(text: Y.Text, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (text.toString() !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(text.toString(), expected);
}

test("bridges legacy-transport Yjs updates through Hocuspocus without duplicate loops", async () => {
  const server = new Server({
    port: 0,
    address: "127.0.0.1",
    quiet: true,
    stopOnSignals: false,
  });
  const clients: Array<{
    document: Y.Doc;
    hocuspocus: HocuspocusProvider;
  }> = [];

  try {
    await server.listen();
    const documentName = `console-room-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const url = `ws://127.0.0.1:${server.address.port}`;
    const createClient = () => {
      const document = new Y.Doc();
      const hocuspocus = new HocuspocusProvider({
        url,
        name: documentName,
        document,
      });
      const client = { document, hocuspocus };
      clients.push(client);
      return client;
    };

    const first = createClient();
    const second = createClient();
    await Promise.all([
      waitForSynced(first.hocuspocus),
      waitForSynced(second.hocuspocus),
    ]);

    const firstRemotePeer = new Y.Doc();
    firstRemotePeer.getText("console-file-personal:first").insert(0, "legacy ");
    Y.applyUpdate(
      first.document,
      Y.encodeStateAsUpdate(firstRemotePeer),
      Symbol("legacy-webrtc"),
    );
    await waitForValue(
      second.document.getText("console-file-personal:first"),
      "legacy ",
    );

    second.document.getText("console-file-personal:second").insert(0, "central");
    await waitForValue(
      first.document.getText("console-file-personal:second"),
      "central",
    );

    let duplicateEvents = 0;
    first.document.on("update", () => {
      duplicateEvents += 1;
    });
    const secondState = Y.encodeStateAsUpdate(second.document);
    Y.applyUpdate(first.document, secondState, first.hocuspocus);
    assert.equal(first.document.getText("console-file-personal:second").toString(), "central");
    assert.equal(duplicateEvents, 0);
    firstRemotePeer.destroy();
  } finally {
    for (const client of clients) {
      client.hocuspocus.destroy();
      client.document.destroy();
    }
    await server.destroy();
  }
});
