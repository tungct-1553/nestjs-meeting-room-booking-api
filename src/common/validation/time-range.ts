export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

export function isFutureTimeRange({ startAt, endAt }: TimeRange, now: number): boolean {
  return (
    Number.isFinite(startAt.getTime()) &&
    Number.isFinite(endAt.getTime()) &&
    startAt.getTime() > now &&
    startAt < endAt
  );
}
