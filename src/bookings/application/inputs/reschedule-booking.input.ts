import type { TimeRange } from '../../../common/validation/time-range';

export interface RescheduleBookingInput extends TimeRange {
  actorSub: string;
  bookingId: string;
}
