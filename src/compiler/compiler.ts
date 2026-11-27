import type { CompilerRequest, CompilerResult } from "./types.js";

export interface Compiler {
  run(request: CompilerRequest, signal: AbortSignal): Promise<CompilerResult>;
}
