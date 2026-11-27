export function updateCursorPosition(
  editor: HTMLTextAreaElement,
  cursorPosition: HTMLElement,
): void {
  const textBeforeCursor = editor.value.slice(0, editor.selectionStart);
  const lineNumber = textBeforeCursor.split("\n").length;
  const columnNumber = textBeforeCursor.length - textBeforeCursor.lastIndexOf("\n");
  cursorPosition.textContent = `Ln ${lineNumber}, Col ${columnNumber}`;
}
