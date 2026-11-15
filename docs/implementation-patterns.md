# DI và transaction

## Connection pool

[DatabaseModule](../src/database/database.module.ts) đăng ký DataSource bằng async provider; các feature import cùng module để dùng chung pool.

```ts
{
  provide: DataSource,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => new DataSource(databaseOptions(
    config.getOrThrow<string>('DATABASE_URL'),
    config.getOrThrow<number>('DB_POOL_MAX'),
  )).initialize(),
}
```

`DatabaseLifecycle.onApplicationShutdown` gọi `destroy()` nếu DataSource còn initialized. `main.ts` bật `enableShutdownHooks()`. TypeORM CLI dùng DataSource riêng từ `src/database/data-source.ts`; CLI sở hữu vòng đời kết nối của tiến trình migration.

## Port và DI token

[BookingUnitOfWork](../src/bookings/ports/booking-unit-of-work.port.ts) thuộc Bookings. Callback nhận các port không chứa kiểu ORM:

```ts
export const BOOKING_UNIT_OF_WORK = Symbol('BOOKING_UNIT_OF_WORK');

export interface BookingTransaction {
  rooms: RoomsBookingAccess;
  bookings: BookingRepositoryPort;
}

export interface BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}
```

`BookingsModule` đăng ký adapter:

```ts
@Module({
  imports: [DatabaseModule, UsersModule, RoomsModule],
  providers: [
    BookingsService,
    { provide: BOOKING_UNIT_OF_WORK, useClass: TypeormBookingUnitOfWork },
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
```

Service inject port qua token:

```ts
constructor(
  private readonly users: UsersService,
  @Inject(BOOKING_UNIT_OF_WORK) private readonly uow: BookingUnitOfWork,
) {}
```

Interface dùng `import type`; DI token và provider class dùng value import.

## Transaction adapter

[TypeormBookingUnitOfWork](../src/bookings/infrastructure/typeorm-booking-unit-of-work.ts) bind các adapter vào cùng manager:

```ts
async run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T> {
  try {
    return await this.source.transaction('READ COMMITTED', (manager) => work({
      rooms: this.roomsFactory.bind(manager),
      bookings: new TypeormBookingRepository(manager),
    }));
  } catch (error) {
    if (error instanceof QueryFailedError) {
      const pg = error.driverError as { code?: string; constraint?: string };
      if (pg.code === '23P01' && pg.constraint === 'bookings_no_overlap') {
        throw new BookingTimeConflictError();
      }
    }
    throw error;
  }
}
```

[RoomsTransactionFactory](../src/rooms/infrastructure/public/rooms-transaction.factory.ts) là API persistence công khai của Rooms. `bind(manager)` trả `RoomsBookingAccess`; `lockForBooking` truy vấn phòng với `pessimistic_write` và trả `{ id, isActive }`. Factory giữ `RoomEntity` trong module Rooms.

Factory và booking repository kiểm tra `queryRunner.isTransactionActive` và `queryRunner.isReleased` trước mỗi thao tác. Các đối tượng gắn manager không được lưu ngoài callback. DataSource, factory và unit of work là singleton; booking repository và Rooms access được tạo cho từng transaction.

## Application service

[BookingsService.create](../src/bookings/bookings.service.ts) đồng bộ user trước khi mở transaction và kiểm tra thời gian sau khi lấy khóa:

```ts
const user = await this.users.getOrSync(principal);
const startAt = new Date(dto.startAt);
const endAt = new Date(dto.endAt);

return this.uow.run(async ({ rooms, bookings }) => {
  const room = await rooms.lockForBooking(dto.roomId);
  if (!room?.isActive) throw new RoomUnavailableError();
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())
    || startAt.getTime() <= Date.now() || startAt >= endAt) {
    throw new InvalidBookingTimeError();
  }
  return bookings.insert({
    roomId: room.id, userId: user.id, title: dto.title, startAt, endAt,
  });
});
```

`RoomsService.deactivate` gọi repository nội bộ của Rooms. Adapter mở transaction, khóa dòng phòng bằng `pessimistic_write`, sau đó cập nhật `isActive = false`. Quy tắc tranh chấp khóa được mô tả tại [architecture.md](architecture.md).

## Response

Handler trả đối tượng nghiệp vụ để interceptor tạo `{ data: object }`. Danh sách phân trang dùng `PaginatedResponse<T>`:

```ts
return new PaginatedResponse(rows, { page, limit, total });
// { data: rows, meta: { page, limit, total } }
```

Health dùng `RawResponse`; HTTP 204 có body rỗng. Exception filter ánh xạ `RoomUnavailableError`/`RoomNotFoundError` thành 404, `InvalidBookingTimeError` thành 400 và `BookingTimeConflictError` thành 409 theo [API contract](requirements.md).
