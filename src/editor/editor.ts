import { updateCursorPosition } from "./cursor.js";
import { highlightCode } from "./highlighting.js";

export interface EditorOptions {
  initialCode: string | null;
  onCodeChanged: (code: string) => void;
}

export function initializeEditor({ initialCode, onCodeChanged }: EditorOptions): HTMLTextAreaElement {
  const editor = document.querySelector<HTMLTextAreaElement>("#codeEditor");
  const codeHighlight = document.querySelector<HTMLElement>("#codeHighlight");
  const lineNumbers = document.querySelector<HTMLElement>("#lineNumbers");
  const cursorPosition = document.querySelector<HTMLElement>("#cursorPosition");

  if (!editor || !codeHighlight || !lineNumbers || !cursorPosition) {
    throw new Error("Elementos necessários para o editor não foram encontrados.");
  }

  const activeEditor = editor;
  const activeCodeHighlight = codeHighlight;
  const activeLineNumbers = lineNumbers;
  const activeCursorPosition = cursorPosition;

  if (initialCode !== null) activeEditor.value = initialCode;

  function renderEditor(): void {
    activeLineNumbers.textContent = Array.from(
      { length: activeEditor.value.split("\n").length },
      (_, index) => index + 1,
    ).join("\n");
    activeCodeHighlight.innerHTML = highlightCode(activeEditor.value);
    updateCursorPosition(activeEditor, activeCursorPosition);
  }

  activeEditor.addEventListener("input", () => {
    onCodeChanged(activeEditor.value);
    renderEditor();
  });
  activeEditor.addEventListener("click", () =>
    updateCursorPosition(activeEditor, activeCursorPosition));
  activeEditor.addEventListener("keyup", () =>
    updateCursorPosition(activeEditor, activeCursorPosition));
  activeEditor.addEventListener("select", () =>
    updateCursorPosition(activeEditor, activeCursorPosition));
  activeEditor.addEventListener("scroll", () => {
    activeLineNumbers.scrollTop = activeEditor.scrollTop;
    activeCodeHighlight.scrollTop = activeEditor.scrollTop;
    activeCodeHighlight.scrollLeft = activeEditor.scrollLeft;
  });
  activeEditor.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    activeEditor.setRangeText(
      "  ",
      activeEditor.selectionStart,
      activeEditor.selectionEnd,
      "end",
    );
    activeEditor.dispatchEvent(new Event("input", { bubbles: true }));
  });

  renderEditor();
  return activeEditor;
}
