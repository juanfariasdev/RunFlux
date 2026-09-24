/** The record with its keys in alphabetical order, as npm writes dependency lists. */
export function sortedRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}
