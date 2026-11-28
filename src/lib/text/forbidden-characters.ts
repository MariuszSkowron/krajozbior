// Characters that never belong in text typed or imported by a person: control characters (Unicode
// Cc) and format characters (Cf: direction marks and overrides, zero-width spaces and joiners,
// the byte order mark, a soft hyphen). They are invisible, so they can disguise a name or an
// address, and they are what rides along when a text is copied from a web page. A lone surrogate
// is refused too (the database would store it as U+FFFD). One shared rule for news, own
// collections and the catalog import.

const FORBIDDEN_SINGLE_LINE = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const FORBIDDEN_MULTILINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}\p{Cs}]/u;
// Own collection descriptions keep their tab (a text pasted from a sheet).
const FORBIDDEN_MULTILINE_KEEP_TAB = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\p{Cs}]/u;

// The allowed format characters: a zero width joiner between two pictographs (an emoji sequence
// such as a family), also after a variation selector or a skin tone modifier, and the tag
// characters of the flags of England, Scotland and Wales (a black flag, tags, a cancel tag).
const EMOJI_JOINER =
  /(?<=\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)‍(?=\p{Extended_Pictographic})/gu;
const FLAG_TAGS = /(?<=\u{1F3F4})[\u{E0020}-\u{E007E}]+\u{E007F}/gu;

/** True when the text holds a forbidden character; a line feed is allowed only when `allowLineFeed`. */
export function hasForbiddenCharacter(
  text: string,
  allowLineFeed: boolean,
  allowTab = false,
): boolean {
  const rule = !allowLineFeed
    ? FORBIDDEN_SINGLE_LINE
    : allowTab
      ? FORBIDDEN_MULTILINE_KEEP_TAB
      : FORBIDDEN_MULTILINE;

  return rule.test(text.replace(EMOJI_JOINER, "").replace(FLAG_TAGS, ""));
}

export const HIDDEN_CHARACTERS_MESSAGE = "Usuń niewidoczne znaki skopiowane razem z tekstem.";
