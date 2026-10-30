/** Build a merge-safe reserve update. Zero overrides inherited/previous floors. */
export function creditReservesWith(
  current: Readonly<Record<string, number>> | undefined,
  accountId: string,
  reserve: number,
): Record<string, number> {
  return { ...current, [accountId]: reserve }
}
