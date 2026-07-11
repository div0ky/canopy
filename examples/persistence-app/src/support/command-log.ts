export const commandLog: Array<{ readonly arguments: readonly string[]; readonly actor: string }> =
  []
export function resetCommandLog(): void {
  commandLog.length = 0
}
