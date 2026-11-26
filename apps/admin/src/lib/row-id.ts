let counter = 0;

/** Stable React key for a row in an editable list (never sent to the API). */
export function newRowId(): string {
  counter += 1;
  return `row-${counter}`;
}
