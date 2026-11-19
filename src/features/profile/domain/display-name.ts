// How a person is named on a screen (E9-2, Q3). The profile stores a first name
// and the first letter of the family name, never the whole family name. A curator
// sees "Anna K." (docs#63, in the moderation that comes with E4/E5); without a
// name the application says "Odkrywca".

export const ANONYMOUS_NAME = "Odkrywca";

export function formatDisplayName(firstName: string | null, familyInitial: string | null): string {
  if (firstName === null) {
    return ANONYMOUS_NAME;
  }

  return familyInitial === null ? firstName : `${firstName} ${familyInitial}.`;
}

// The letter in the circle that stands in for a photo before E4.
export function avatarLetter(firstName: string | null): string {
  const first = firstName === null ? ANONYMOUS_NAME : firstName;

  return [...first][0]!.toLocaleUpperCase("pl-PL");
}
