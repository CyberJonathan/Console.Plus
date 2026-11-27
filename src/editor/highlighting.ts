const escapedCharacters: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => escapedCharacters[character]);
}

export function highlightCode(value: string): string {
  const tokenPattern =
    /#[ \t]*include[ \t]*<[^>\n]+>|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|#[A-Za-z_]+|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g;
  let outputHtml = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value)) !== null) {
    outputHtml += escapeHtml(value.slice(lastIndex, match.index));
    const token = match[0];
    const escaped = escapeHtml(token);
    let className = "";

    if (/^#[ \t]*include[ \t]*</.test(token)) {
      className = "syntax-library";
    } else if (token.startsWith("//") || token.startsWith("/*")) {
      className = "syntax-comment";
    } else if (token.startsWith('"')) {
      className = "syntax-string";
    } else if (/^(int|char|float|double|void|return|const|if|else|for|while|struct)$/.test(token)) {
      className = "syntax-data";
    } else if (token.startsWith("#")) {
      className = "syntax-keyword";
    } else if (/^(printf|scanf)$/.test(token)) {
      className = "syntax-function";
    } else if (token === "main") {
      className = "syntax-main";
    } else if (/^\d/.test(token)) {
      className = "syntax-number";
    }

    outputHtml += className ? `<span class="${className}">${escaped}</span>` : escaped;
    lastIndex = tokenPattern.lastIndex;
  }

  return outputHtml + escapeHtml(value.slice(lastIndex));
}
