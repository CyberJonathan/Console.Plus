import type { Compiler } from "./compiler.js";
import type { CompilerRequest, CompilerResult } from "./types.js";
import { executeProgram } from "../services/api.js";

const C_LANGUAGE_ID = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class Judge0Compiler implements Compiler {
  async run(request: CompilerRequest, signal: AbortSignal): Promise<CompilerResult> {
    const result = await executeProgram(
      { ...request, languageId: C_LANGUAGE_ID },
      signal,
    );
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const compileOutput =
      typeof result.compile_output === "string" ? result.compile_output : "";
    const status = isRecord(result.status) ? result.status : null;
    const statusId = typeof status?.id === "number" ? status.id : undefined;
    const statusDescription =
      typeof status?.description === "string" ? status.description : undefined;
    const needsInput = result.needsInput === true;
    const failed = Boolean(
      compileOutput || (stderr && !needsInput) || (statusId !== undefined && statusId >= 4),
    );
    const executionTimeMs = result.time
      ? Math.round(Number(result.time) * 1000)
      : 0;

    return {
      stdout,
      stderr,
      compileOutput,
      statusDescription,
      executionTimeMs,
      needsInput,
      failed,
    };
  }
}

export function createCompiler(): Compiler {
  return new Judge0Compiler();
}
