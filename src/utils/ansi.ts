/**
 * Strip ANSI escape sequences from terminal output.
 * Removes color codes, cursor control, and other escape sequences
 * so AI receives clean, readable text.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001B\[[0-9;]*[a-zA-Z]/g, '');
}
