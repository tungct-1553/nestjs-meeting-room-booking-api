export function isValidBookingTime(startAt: Date, endAt: Date, now: number): boolean {
  return (
    Number.isFinite(startAt.getTime()) &&
    Number.isFinite(endAt.getTime()) &&
    startAt.getTime() > now &&
    startAt < endAt
  );
}
