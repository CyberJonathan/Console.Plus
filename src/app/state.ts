import type { CompilerRequest } from "../compiler/types.js";

export interface ExecutionInput {
  text: string;
  stdoutOffset: number;
}

export interface ExecutionSession {
  sourceCode: string;
  seed: number;
  inputs: ExecutionInput[];
  lastStdout: string;
}

export interface AppState {
  executionSession: ExecutionSession | null;
  activeRunController: AbortController | null;
}

export function createAppState(): AppState {
  return {
    executionSession: null,
    activeRunController: null,
  };
}

export function createExecutionRequest(
  session: ExecutionSession,
  sendEof: boolean,
): CompilerRequest {
  return {
    sourceCode: session.sourceCode,
    stdin: session.inputs.map((entry) => `${entry.text}\n`).join(""),
    sessionSeed: session.seed,
    sendEof,
  };
}
