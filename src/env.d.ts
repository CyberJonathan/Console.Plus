/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOCUSPOCUS_ENABLED?: string;
  readonly VITE_HOCUSPOCUS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
