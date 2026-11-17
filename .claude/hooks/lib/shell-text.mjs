// Shared text helpers of the PreToolUse hooks. The hooks never run the command;
// they read its text. These helpers turn the text into something the checks
// can rely on, erring on the side of "suspicious":
//
// - line continuations (`\` + newline in Bash, backtick + newline in
//   PowerShell) are joined, so a command split over lines reads as one;
// - segments are cut at every command separator (`;`, `&`, `|`, newline),
//   also inside quotes (a quoted part never makes a command look safer);
// - detection variants remove the quoting and escape characters that a shell
//   would remove (`m"er"ge`, `m\erge`, PowerShell `` mer`ge ``), so an
//   obfuscated word reads as the word it becomes.

/**
 * Joins Bash and PowerShell line continuations the way the shell does: the
 * escape and the newline disappear, so `.e\<newline>nv` reads as `.env`.
 */
export function joinContinuations(command) {
  return command.replace(/[\\`]\r?\n/g, "");
}

/** Command segments: the text between separators, trimmed, without empty ones. */
export function splitSegments(command) {
  return joinContinuations(command)
    .split(/[;&|\r\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Detection variants of a text: as typed, without quotes and backticks, and
 * additionally without backslashes. A check runs on every variant; a Windows
 * path (`C:\tools\gh.exe`) survives in the first two, a Bash escape
 * (`g\h`) is resolved in the last one.
 */
export function detectionVariants(text) {
  const unquoted = text.replace(/["'`]/g, "");

  return [...new Set([text, unquoted, unquoted.replace(/\\/g, "")])];
}

/** Whitespace-separated words. */
export function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** The file name of a word that may be a path (`C:\tools\gh.exe` -> `gh.exe`). */
export function baseName(word) {
  return word.split(/[\\/]/).pop().toLowerCase();
}

/** A shell/PowerShell glob as a regular expression over one file name. */
export function globToRegExp(glob) {
  let source = "";

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];

    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end === -1) {
        source += "\\[";
        continue;
      }
      let body = glob.slice(i + 1, end);
      const negated = body.startsWith("!") || body.startsWith("^");
      if (negated) body = body.slice(1);
      source += `[${negated ? "^" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
      i = end;
    } else if (char === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        source += "\\{";
        continue;
      }
      const options = glob.slice(i + 1, end).split(",");
      source += `(?:${options.map((option) => option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
      i = end;
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

// ---------------------------------------------------------------------------
// Message arguments: the only text in a command treated as data.
//
// The quoted message of `git commit -m/--message/-am` and the quoted
// `-t/--title/-b/--body` of `gh pr|issue create|edit|comment` is never run.
// A hook that read it as a command would block a commit message or a PR
// description that merely mentions a protected word. `maskShellData` replaces
// such a message with `MESSAGE` – but only in a plain, one-line command whose
// quoting Bash and PowerShell read the same way. Otherwise nothing is masked
// and the hooks apply their strict rules to the whole text (a false block is
// acceptable, a bypass is not). Nothing is masked when the command has:
//
// - a newline (also no heredocs, no here-strings, no multi-line comments);
// - outside quotes any character other than letters, digits, whitespace,
//   `_ . , : / = + -` and the separators `;` and `&` – so no `#` comment,
//   `<#`, `$`, `$'`, `$"`, `(`, `{`, `|`, `<`, `>`, `<<`, `@`, `\`, glob;
// - anywhere: a backtick, `\` before a quote, `$` inside double quotes,
//   an unclosed or typographic quote, or two quoted parts glued together
//   (`'a''b'` – PowerShell reads `''` as an escaped quote);
// - a program word that is not plainly `git` / `gh` (no path, no quotes).
//
// Heredoc bodies are never data: they are checked like any other text.

const GIT_MESSAGE_FLAG = /^(?:-[asnvq]*m|--message)$/;
const GH_MESSAGE_FLAG = /^(?:-t|--title|-b|--body)$/;
const GH_MESSAGE_SUBCOMMANDS = new Set(["create", "edit", "comment"]);
const MESSAGE_PLACEHOLDER = "MESSAGE";
const TYPOGRAPHIC_QUOTES = /[‘-‟]/;
// Characters allowed outside quotes when anything is to be masked.
const PLAIN_OUTSIDE_QUOTES = /^[A-Za-z0-9_.,:/=+\-;& \t]$/;
const MESSAGE_PROGRAMS = /^(?:git|gh)(?:\.exe)?$/i;

/**
 * The pattern of message flags when the words are `git [-C x|-c x] commit` or
 * `gh [-R x] pr|issue create|edit|comment`; null for any other command.
 */
export function messageFlagPattern(values) {
  if (!MESSAGE_PROGRAMS.test(values[0] ?? "")) return null;
  const program = values[0].toLowerCase().replace(/\.exe$/, "");
  let i = 1;

  if (program === "git") {
    while (i < values.length && /^-[Cc]$/.test(values[i])) i += 2;
    return values[i] === "commit" ? GIT_MESSAGE_FLAG : null;
  }
  while (i < values.length && /^(?:-R|--repo)(?:=|$)/.test(values[i])) {
    i += values[i].includes("=") ? 1 : 2;
  }
  const isMessage =
    (values[i] === "pr" || values[i] === "issue") && GH_MESSAGE_SUBCOMMANDS.has(values[i + 1]);
  return isMessage ? GH_MESSAGE_FLAG : null;
}

/**
 * The quoted spans of a text (`{ start, end, quote }`, `end` = closing quote),
 * or null when the command is not plain enough to mask anything (see above).
 */
function quotedSpans(text) {
  if (/[\r\n`]/.test(text) || TYPOGRAPHIC_QUOTES.test(text)) return null;
  if (/\["']/.test(text)) return null;
  const spans = [];

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === "'" || char === '"') {
      const end = text.indexOf(char, i + 1);
      if (end === -1) return null;
      if (char === '"' && text.slice(i + 1, end).includes("$")) return null;
      // Two quoted parts glued together (`'a''b'`, `"a"'b'`).
      if (/["']/.test(text[end + 1] ?? "")) return null;
      spans.push({ start: i, end, quote: char });
      i = end;
    } else if (!PLAIN_OUTSIDE_QUOTES.test(char)) return null;
  }
  return spans;
}

/** Simple commands as lists of words; a word is a list of bare and quoted parts. */
function tokenize(text, spans) {
  const spanAt = new Map(spans.map((span) => [span.start, span]));
  const commands = [];
  let current = [];
  let word = null;
  const endWord = () => {
    if (word) current.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (current.length > 0) commands.push(current);
    current = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const span = spanAt.get(i);
    if (span) {
      word ??= [];
      word.push({ span, text: text.slice(span.start + 1, span.end) });
      i = span.end;
    } else if (/[;&]/.test(text[i])) endCommand();
    else if (/\s/.test(text[i])) endWord();
    else {
      word ??= [];
      const last = word[word.length - 1];
      if (last && !last.span) last.text += text[i];
      else word.push({ span: null, text: text[i] });
    }
  }
  endCommand();
  return commands;
}

/** The quoted part a message flag word carries or points to, or null. */
function messagePart(commandWords, index, pattern) {
  const word = commandWords[index];
  const [first, second] = word;

  if (word.length === 1 && !first.span && pattern.test(first.text)) {
    const next = commandWords[index + 1];
    return next?.length === 1 && next[0].span ? next[0] : null;
  }
  if (word.length === 2 && !first.span && second.span) {
    return pattern.test(first.text.replace(/=$/, "")) ? second : null;
  }
  return null;
}

/**
 * The command (continuations joined) with the quoted message of `git commit`
 * and of `gh pr|issue create|edit|comment` replaced by `MESSAGE`. When the
 * command is not plain enough (see above), the text is returned unchanged.
 */
export function maskShellData(command) {
  const text = joinContinuations(command);
  // Checked before joining: inside single quotes Bash keeps `\` + newline.
  const spans = /[\r\n]/.test(command) ? null : quotedSpans(text);
  if (spans === null) return text;
  const replacements = new Map();

  for (const commandWords of tokenize(text, spans)) {
    const first = commandWords[0];
    // The program word must be typed bare: `git`, not `"git"` or `./git`.
    if (first.length !== 1 || first[0].span) continue;
    const pattern = messageFlagPattern(
      commandWords.map((word) => word.map((p) => p.text).join("")),
    );
    if (!pattern) continue;

    commandWords.forEach((_, index) => {
      const part = messagePart(commandWords, index, pattern);
      if (part) replacements.set(part.span, MESSAGE_PLACEHOLDER);
    });
  }

  let result = text;
  for (const [span, inner] of [...replacements].sort((a, b) => b[0].start - a[0].start)) {
    result = result.slice(0, span.start + 1) + inner + result.slice(span.end);
  }
  return result;
}
