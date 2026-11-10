import { randomBytes } from "node:crypto";

const INPUT_MARKER_PREFIX = "__CONSOLE_NEEDS_INPUT_";
const INTERNAL_SOURCE_NAME = "console_internal_runtime.c";
const MAX_SOURCE_BYTES = 100_000;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_SEED = 0xffff_ffff;

const wrappedFunctions = [
  "scanf",
  "__isoc99_scanf",
  "__isoc23_scanf",
  "fscanf",
  "__isoc99_fscanf",
  "__isoc23_fscanf",
  "getchar",
  "getc",
  "_IO_getc",
  "fgetc",
  "fgets",
  "getline",
  "time",
  "clock",
  "gettimeofday",
  "clock_gettime",
];

export interface RunInput {
  sourceCode: string;
  languageId: number;
  stdin: string;
  sessionSeed: number;
  sendEof: boolean;
}

export interface RunValidation {
  input?: RunInput;
  error?: string;
}

export class Judge0RequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly details?: string,
  ) {
    super(message);
    this.name = "Judge0RequestError";
  }
}

export class Judge0AbortError extends Error {
  constructor() {
    super("A requisição de execução foi cancelada.");
    this.name = "AbortError";
  }
}

export function validateRunInput(value: unknown): RunValidation {
  const body = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const { sourceCode, stdin = "", sessionSeed = 0, sendEof = false } = body;

  if (typeof sourceCode !== "string" || sourceCode.length === 0) {
    return { error: "sourceCode deve ser um texto de até 100 KB e não vazio." };
  }
  if (Buffer.byteLength(sourceCode, "utf8") > MAX_SOURCE_BYTES) {
    return { error: "sourceCode deve ser um texto de até 100 KB e não vazio." };
  }
  if (typeof stdin !== "string") {
    return { error: "stdin deve ser uma string." };
  }
  if (Buffer.byteLength(stdin, "utf8") > MAX_STDIN_BYTES) {
    return { error: "A entrada acumulada não pode ultrapassar 64 KB." };
  }
  if (
    typeof sessionSeed !== "number" ||
    !Number.isInteger(sessionSeed) ||
    sessionSeed < 0 ||
    sessionSeed > MAX_SEED
  ) {
    return { error: "sessionSeed deve ser um inteiro entre 0 e 4294967295." };
  }
  if (typeof sendEof !== "boolean") {
    return { error: "sendEof deve ser boolean." };
  }

  const rawLanguageId = body.languageId ?? 50;
  let languageId: number;
  if (typeof rawLanguageId === "number" && Number.isInteger(rawLanguageId) && rawLanguageId > 0) {
    languageId = rawLanguageId;
  } else if (typeof rawLanguageId === "string" && rawLanguageId.trim() !== "") {
    languageId = Number(rawLanguageId);
    if (!Number.isInteger(languageId) || languageId <= 0) {
      return { error: "languageId deve ser um número inteiro positivo." };
    }
  } else {
    return { error: "languageId deve ser um número inteiro positivo." };
  }

  return {
    input: {
      sourceCode,
      languageId,
      stdin,
      sessionSeed,
      sendEof,
    },
  };
}

export function getCompilerOptions(): string {
  return wrappedFunctions.map((name) => `-Wl,--wrap=${name}`).join(" ");
}

export function createInstrumentedSource(
  sourceCode: string,
  marker: string,
  sessionSeed: number,
  sendEof: boolean,
): string {
  const markerLiteral = JSON.stringify(`${INPUT_MARKER_PREFIX}${marker}__`);
  const detectionEnabled = sendEof ? 0 : 1;

  return `${sourceCode}

#line 1 "${INTERNAL_SOURCE_NAME}"
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <sys/types.h>
#include <sys/time.h>
#include <unistd.h>

#define CONSOLE_SESSION_SEED ${sessionSeed}U
#define CONSOLE_DETECT_EOF ${detectionEnabled}
#define CONSOLE_INPUT_MARKER ${markerLiteral}

static void console_check_stdin_eof(FILE *stream) {
#if CONSOLE_DETECT_EOF
  if (stream == stdin && feof(stdin)) {
    fflush(stdout);
    fputs(CONSOLE_INPUT_MARKER, stderr);
    fflush(stderr);
    _exit(0);
  }
#else
  (void)stream;
#endif
}

extern int console_real_vscanf(const char *, va_list) __asm__("vscanf");
extern int console_real_vfscanf(FILE *, const char *, va_list) __asm__("vfscanf");
extern int console_real_getchar(void) __asm__("__real_getchar");
extern int console_real_fgetc(FILE *) __asm__("__real_fgetc");
extern char *console_real_fgets(char *, int, FILE *) __asm__("__real_fgets");
extern ssize_t console_real_getline(char **, size_t *, FILE *) __asm__("__real_getline");

int __wrap_scanf(const char *format, ...) {
  va_list args;
  va_start(args, format);
  int result = console_real_vscanf(format, args);
  va_end(args);
  console_check_stdin_eof(stdin);
  return result;
}

int __wrap___isoc99_scanf(const char *format, ...) {
  va_list args;
  va_start(args, format);
  int result = console_real_vscanf(format, args);
  va_end(args);
  console_check_stdin_eof(stdin);
  return result;
}

int __wrap___isoc23_scanf(const char *format, ...) {
  va_list args;
  va_start(args, format);
  int result = console_real_vscanf(format, args);
  va_end(args);
  console_check_stdin_eof(stdin);
  return result;
}

int __wrap_fscanf(FILE *stream, const char *format, ...) {
  va_list args;
  va_start(args, format);
  int result = console_real_vfscanf(stream, format, args);
  va_end(args);
  console_check_stdin_eof(stream);
  return result;
}

int __wrap___isoc99_fscanf(FILE *stream, const char *format, ...) {
  va_list args;
  va_start(args, format);
  int result = console_real_vfscanf(stream, format, args);
  va_end(args);
  console_check_stdin_eof(stream);
  return result;
}

int __wrap___isoc23_fscanf(FILE *stream, const char *format, ...) {
  va_list args;
  va_start(args, format);
  int result = console_real_vfscanf(stream, format, args);
  va_end(args);
  console_check_stdin_eof(stream);
  return result;
}

int __wrap_getchar(void) {
  int result = console_real_getchar();
  console_check_stdin_eof(stdin);
  return result;
}

int __wrap_getc(FILE *stream) {
  int result = console_real_fgetc(stream);
  console_check_stdin_eof(stream);
  return result;
}

int __wrap__IO_getc(FILE *stream) {
  int result = console_real_fgetc(stream);
  console_check_stdin_eof(stream);
  return result;
}

int __wrap_fgetc(FILE *stream) {
  int result = console_real_fgetc(stream);
  console_check_stdin_eof(stream);
  return result;
}

char *__wrap_fgets(char *buffer, int size, FILE *stream) {
  char *result = console_real_fgets(buffer, size, stream);
  console_check_stdin_eof(stream);
  return result;
}

ssize_t __wrap_getline(char **line, size_t *capacity, FILE *stream) {
  ssize_t result = console_real_getline(line, capacity, stream);
  console_check_stdin_eof(stream);
  return result;
}

time_t __wrap_time(time_t *result) {
  time_t fixed = (time_t)1700000000 + (time_t)CONSOLE_SESSION_SEED;
  if (result != NULL) *result = fixed;
  return fixed;
}

clock_t __wrap_clock(void) {
  return (clock_t)0;
}

int __wrap_gettimeofday(struct timeval *result, void *timezone) {
  (void)timezone;
  if (result == NULL) return -1;
  result->tv_sec = (time_t)1700000000 + (time_t)CONSOLE_SESSION_SEED;
  result->tv_usec = 0;
  return 0;
}

int __wrap_clock_gettime(clockid_t clockId, struct timespec *result) {
  (void)clockId;
  if (result == NULL) return -1;
  result->tv_sec = (time_t)1700000000 + (time_t)CONSOLE_SESSION_SEED;
  result->tv_nsec = 0;
  return 0;
}
`;
}

function decodeBase64Fields(result: Record<string, unknown>): void {
  for (const field of ["stdout", "stderr", "compile_output", "message"]) {
    if (typeof result[field] === "string") {
      result[field] = Buffer.from(result[field], "base64").toString("utf8");
    }
  }
}

function hideInternalCompileErrors(compileOutput: string): string {
  const visibleLines = compileOutput
    .split("\n")
    .filter((line) => !line.includes(INTERNAL_SOURCE_NAME));
  if (visibleLines.length === compileOutput.split("\n").length) return compileOutput;
  const visibleOutput = visibleLines.join("\n").trim();
  return [visibleOutput, "Erro interno ao preparar a execução interativa."]
    .filter(Boolean)
    .join("\n");
}

export async function executeJudge0(
  input: RunInput,
  options: {
    judge0Url: string;
    timeoutMs: number;
    authToken?: string;
    signal?: AbortSignal;
  },
): Promise<Record<string, unknown> & { needsInput: boolean }> {
  const marker = randomBytes(16).toString("hex");
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);
  const abortFromCaller = () => abortController.abort();
  if (options.signal?.aborted) abortController.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.authToken) headers["X-Auth-Token"] = options.authToken;

    const submission = await fetch(
      `${options.judge0Url}/submissions?base64_encoded=true&wait=true`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          source_code: Buffer.from(
            createInstrumentedSource(input.sourceCode, marker, input.sessionSeed, input.sendEof),
            "utf8",
          ).toString("base64"),
          language_id: input.languageId,
          compiler_options: getCompilerOptions(),
          stdin: Buffer.from(input.stdin, "utf8").toString("base64"),
        }),
        signal: abortController.signal,
      },
    );

    if (!submission.ok) {
      const details = await submission.text();
      throw new Judge0RequestError(
        "O serviço Judge0 recusou a execução.",
        submission.status,
        details || "O Judge0 não informou detalhes.",
      );
    }

    const responseText = await submission.text();
    let parsedResult: unknown;
    try {
      parsedResult = JSON.parse(responseText);
    } catch {
      throw new Judge0RequestError(
        "O Judge0 devolveu uma resposta que não está em formato JSON.",
        502,
        responseText.trim().slice(0, 1_000) || "A resposta do Judge0 estava vazia.",
      );
    }
    if (!parsedResult || typeof parsedResult !== "object" || Array.isArray(parsedResult)) {
      throw new Judge0RequestError(
        "O Judge0 devolveu uma resposta inválida.",
        502,
        "Esperava-se um objeto JSON com o resultado da execução.",
      );
    }
    const result = parsedResult as Record<string, unknown>;
    decodeBase64Fields(result);
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const markerText = `${INPUT_MARKER_PREFIX}${marker}__`;
    const needsInput = stderr.includes(markerText);
    result.stderr = stderr.split(markerText).join("");
    if (typeof result.stdout === "string") {
      result.stdout = result.stdout.split(markerText).join("");
    }
    if (typeof result.compile_output === "string") {
      result.compile_output = hideInternalCompileErrors(result.compile_output);
    }
    return { ...result, needsInput };
  } catch (error) {
    if (options.signal?.aborted) throw new Judge0AbortError();
    if (abortController.signal.aborted) {
      throw new Judge0RequestError(
        "O Judge0 demorou mais que o limite para responder.",
        504,
        `Limite configurado: ${options.timeoutMs} ms.`,
      );
    }
    if (error instanceof Judge0RequestError) throw error;
    console.error("Judge0 indisponível:", error);
    throw new Judge0RequestError("Não foi possível conectar ao Judge0.", 502);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
