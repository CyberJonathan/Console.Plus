import type { ExecutionApiRequest, ExecutionApiResponse } from "../compiler/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function executeProgram(
  request: ExecutionApiRequest,
  signal: AbortSignal,
): Promise<ExecutionApiResponse> {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify(request),
  });
  const responseText = await response.text();
  let result: unknown;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    const preview = responseText.replace(/\s+/g, " ").trim().slice(0, 240);
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new Error(
      `A API retornou uma resposta inválida (HTTP ${status}).${preview ? ` Resposta: ${preview}` : ""}`,
    );
  }

  if (!response.ok) {
    const error = isRecord(result) && typeof result.error === "string"
      ? result.error
      : "O backend recusou a execução.";
    const details = isRecord(result) && typeof result.details === "string"
      ? ` ${result.details}`
      : "";
    throw new Error(`${error}${details}`);
  }

  if (!isRecord(result)) {
    throw new Error("A API retornou uma resposta inválida.");
  }

  return result;
}
