const SOURCE_EXTENSIONS = /(?:\.bat|\.sys)$/i;
const COMMANDS = new Set([
  "call",
  "choice",
  "command",
  "echo",
  "exit",
  "for",
  "goto",
  "if",
  "rem",
  "set",
  "shift",
]);

export function pathKey(path) {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .reduce((parts, part) => {
      if (part === "..") parts.pop();
      else parts.push(part);
      return parts;
    }, [])
    .join("/")
    .toLowerCase();
}

export function detectLineEnding(text) {
  const endings = String(text).match(/\r\n|\r|\n/g) || [];
  const distinct = new Set(endings);
  if (!endings.length) return { lineEnding: "CRLF", mixed: false };
  if (distinct.size > 1) return { lineEnding: "CRLF", mixed: true };
  return {
    lineEnding:
      endings[0] === "\r\n" ? "CRLF" : endings[0] === "\r" ? "CR" : "LF",
    mixed: false,
  };
}

export function normalizeText(text) {
  return String(text).replace(/\r\n|\r/g, "\n");
}

export function serializeSource(source) {
  const separator =
    source.lineEnding === "LF"
      ? "\n"
      : source.lineEnding === "CR"
        ? "\r"
        : "\r\n";
  return normalizeText(source.text).replace(/\n/g, separator);
}

export async function readSourceFiles(fileList) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const sources = [];
  const seen = new Set();

  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name;
    if (!SOURCE_EXTENSIONS.test(path)) continue;
    const key = pathKey(path);
    if (!key || seen.has(key)) throw new Error(`Duplicate DOS path: ${path}`);
    seen.add(key);

    let decoded;
    try {
      decoded = decoder.decode(await file.arrayBuffer());
    } catch {
      throw new Error(`${path} is not valid UTF-8.`);
    }
    const endings = detectLineEnding(decoded);
    sources.push({
      key,
      path: path.replace(/\\/g, "/"),
      text: normalizeText(decoded),
      lineEnding: endings.lineEnding,
      mixed: endings.mixed,
      dirty: false,
    });
  }

  if (!sources.length) throw new Error("Choose at least one BAT or SYS file.");
  return sources;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightCode(line) {
  const pattern = /("[^"]*")|(%[^%\r\n]+%)|(^|\s)(@?[a-z][a-z0-9.]*)/gi;
  let result = "";
  let offset = 0;
  for (const match of line.matchAll(pattern)) {
    result += escapeHtml(line.slice(offset, match.index));
    if (match[1]) {
      const string = escapeHtml(match[1]).replace(
        /%[^%\r\n]+%/g,
        '<span class="tok-variable">$&</span>',
      );
      result += `<span class="tok-string">${string}</span>`;
    } else if (match[2]) {
      result += `<span class="tok-variable">${escapeHtml(match[2])}</span>`;
    } else {
      const whitespace = match[3] || "";
      const raw = match[4];
      const command = raw.replace(/^@/, "").toLowerCase();
      result += escapeHtml(whitespace);
      result += COMMANDS.has(command)
        ? `<span class="tok-command">${escapeHtml(raw)}</span>`
        : escapeHtml(raw);
    }
    offset = match.index + match[0].length;
  }
  return result + escapeHtml(line.slice(offset));
}

export function highlightSource(text) {
  return normalizeText(text)
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (/^(?:rem(?:\s|$)|::)/i.test(trimmed)) {
        return `<span class="tok-comment">${escapeHtml(line)}</span>`;
      }
      if (/^:[^:]/.test(trimmed)) {
        return `<span class="tok-label">${escapeHtml(line)}</span>`;
      }
      return highlightCode(line);
    })
    .join("\n");
}
