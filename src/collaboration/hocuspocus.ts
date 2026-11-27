import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

export interface HocuspocusResources {
  awarenessDocument: Y.Doc;
  provider: HocuspocusProvider;
  websocket: HocuspocusProviderWebsocket;
}

interface CreateHocuspocusResourcesOptions {
  document: Y.Doc;
  name: string;
  token: () => Promise<string>;
  url: string;
}

export function createHocuspocusResources({
  document,
  name,
  token,
  url,
}: CreateHocuspocusResourcesOptions): HocuspocusResources {
  const awarenessDocument = new Y.Doc();
  const awareness = new Awareness(awarenessDocument);
  const websocket = new HocuspocusProviderWebsocket({
    url,
    maxAttempts: 0,
    minDelay: 1_000,
    maxDelay: 30_000,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: websocket,
    name,
    document,
    awareness,
    token,
  });

  return { awarenessDocument, provider, websocket };
}

export function destroyHocuspocusResources(resources: HocuspocusResources): void {
  resources.provider.destroy();
  resources.websocket.destroy();
  resources.awarenessDocument.destroy();
}
