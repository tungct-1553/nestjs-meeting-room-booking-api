import { isFutureTimeRange } from '../../../common/validation/time-range';
import type { TimeRange } from '../../../common/validation/time-range';
import { InvalidRoomInputError } from '../errors/room.errors';

export function validateAvailabilityRange(range: TimeRange): void {
  if (!isFutureTimeRange(range, Date.now())) {
    throw new InvalidRoomInputError(
      'Availability must start in the future and end after it starts',
    );
  }
}

export function findAvailableIntervals(range: TimeRange, busy: TimeRange[]): TimeRange[] {
  const available: TimeRange[] = [];
  let cursor = range.startAt;
  for (const interval of busy) {
    if (cursor < interval.startAt) {
      available.push({ startAt: cursor, endAt: interval.startAt });
    }
    if (cursor < interval.endAt) {
      cursor = interval.endAt;
    }
    if (cursor >= range.endAt) {
      return available;
    }
  }
  available.push({ startAt: cursor, endAt: range.endAt });
  return available;
}
