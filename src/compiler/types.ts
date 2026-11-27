export interface CompilerRequest {
  sourceCode: string;
  stdin: string;
  sessionSeed: number;
  sendEof: boolean;
}

export interface CompilerResult {
  stdout: string;
  stderr: string;
  compileOutput: string;
  statusDescription?: string;
  executionTimeMs: number;
  needsInput: boolean;
  failed: boolean;
}

export interface ExecutionApiRequest extends CompilerRequest {
  languageId: number;
}

export interface ExecutionApiResponse {
  stdout?: unknown;
  stderr?: unknown;
  compile_output?: unknown;
  time?: unknown;
  status?: unknown;
  needsInput?: unknown;
  error?: unknown;
  details?: unknown;
}
