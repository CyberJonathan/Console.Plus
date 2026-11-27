const SOURCE_CODE_KEY = "console-source-code";
const USER_NAME_KEY = "console-user-name";

export function getSavedSourceCode(): string | null {
  return localStorage.getItem(SOURCE_CODE_KEY);
}

export function saveSourceCode(sourceCode: string): void {
  localStorage.setItem(SOURCE_CODE_KEY, sourceCode);
}

export function getSavedUserName(): string | null {
  return localStorage.getItem(USER_NAME_KEY);
}

export function saveUserName(name: string): void {
  localStorage.setItem(USER_NAME_KEY, name);
}
