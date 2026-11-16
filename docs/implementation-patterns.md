# DI và transaction

Các ví dụ dưới là phần trích từ implementation, lược bỏ import và decorator không liên quan. Ranh giới module và thứ tự nghiệp vụ được mô tả trong [architecture.md](architecture.md); tài liệu này tập trung vào cách sử dụng các contract trong code.

## 1. Đăng ký DataSource và lifecycle

[DatabaseModule](../src/database/database.module.ts) đăng ký DataSource bằng async provider. Nest chờ kết nối initialize trước khi inject provider vào adapter; các feature import cùng DatabaseModule để dùng chung pool.

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

Module đăng ký thêm [DatabaseLifecycle](../src/database/database.lifecycle.ts); provider này inject DataSource và đóng pool qua shutdown hook:

```ts
async onApplicationShutdown(): Promise<void> {
  if (this.source.isInitialized) await this.source.destroy();
}

// main.ts
app.enableShutdownHooks();
```

`databaseOptions` dùng chung cho API và TypeORM CLI. CLI chạy trong tiến trình riêng; vòng đời kết nối được mô tả tại [database.md](database.md#migration-và-kết-nối).

## 2. Đăng ký adapter cho port

Users tách port đọc khỏi port đồng bộ; input persistence không chứa token, role hoặc kiểu ORM:

```ts
export const USER_READ_REPOSITORY = Symbol('USER_READ_REPOSITORY');
export const USER_SYNC_REPOSITORY = Symbol('USER_SYNC_REPOSITORY');

export interface UserReadRepositoryPort {
  findBySub(sub: string): Promise<User | null>;
}
export interface ProfileSyncInput {
  sub: string;
  email: string | null;
  displayName: string | null;
  issuedAt: number;
}
export interface UserSyncRepositoryPort {
  sync(input: ProfileSyncInput): Promise<User>;
}
```

`useExisting` nối hai token với cùng một adapter singleton. Module chỉ export service cho feature khác:

```ts
providers: [
  UsersService,
  TypeormUserRepository,
  { provide: USER_READ_REPOSITORY, useExisting: TypeormUserRepository },
  { provide: USER_SYNC_REPOSITORY, useExisting: TypeormUserRepository },
],
exports: [UsersService],

// UsersService
constructor(
  @Inject(USER_READ_REPOSITORY) private readonly reader: UserReadRepositoryPort,
  @Inject(USER_SYNC_REPOSITORY) private readonly writer: UserSyncRepositoryPort,
) {}

async requireBySub(sub: string) {
  const user = await this.reader.findBySub(sub);
  if (!user) throw new UserNotProvisionedError();
  return user;
}
```

Interface dùng `import type`; token dùng value import để tồn tại ở runtime. Service sync kiểm tra `Principal.issuedAt`, rồi truyền profile cùng watermark vào port ghi. Adapter dùng `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` trong transaction `READ COMMITTED`:

```sql
WHERE users.profile_token_iat IS NULL
   OR users.profile_token_iat < EXCLUDED.profile_token_iat
```

Token cùng/cũ hơn không cập nhật snapshot hoặc timestamp. Khi `RETURNING` không có dòng, adapter SELECT hồ sơ hiện tại trong cùng transaction. Upsert đã chờ/giữ khóa conflict; SELECT dùng snapshot mới của `READ COMMITTED` nên đọc được cả dòng do request đồng thời vừa insert. Chi tiết contract nằm tại [user-provisioning.md](user-provisioning.md).

## 3. Gọi service của module khác

[BookingsModule](../src/bookings/bookings.module.ts) import `UsersModule`; [BookingsService](../src/bookings/bookings.service.ts) inject service được export:

```ts
constructor(
  private readonly users: UsersService,
  @Inject(BOOKING_UNIT_OF_WORK) private readonly uow: BookingUnitOfWork,
) {}

// Trong create(principal, dto)
const user = await this.users.requireBySub(principal.sub);
```

Kết quả `user.id` là UUID ứng dụng. Thiếu hồ sơ trả lỗi `USER_NOT_PROVISIONED`; caller không tạo user hoặc cập nhật profile trong luồng này. Lời gọi này hoàn tất trước transaction booking; adapter Users truy vấn qua DataSource dùng chung, ngoài transaction booking và không tham gia callback unit of work.

Không gọi service này giữa callback rồi giả định các query của nó tự dùng transaction manager hiện tại. Tham gia transaction phải đi qua contract được bind manager tường minh như phần dưới.

## 4. Bind persistence vào transaction

[BookingUnitOfWork](../src/bookings/ports/booking-unit-of-work.port.ts) cung cấp bộ thao tác cho callback nghiệp vụ:

```ts
export interface BookingTransaction {
  rooms: RoomsBookingAccess;
  bookings: BookingRepositoryPort;
}

export interface BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}
```

Token `BOOKING_UNIT_OF_WORK` được đăng ký với `TypeormBookingUnitOfWork` trong Bookings. Adapter inject DataSource singleton và factory persistence công khai của Rooms. Khi mở transaction, nó tạo hai đối tượng mới gắn cùng manager:

```ts
return await this.source.transaction('READ COMMITTED', (manager) => work({
  rooms: this.roomsFactory.bind(manager),
  bookings: new TypeormBookingRepository(manager),
}));
```

`RoomsTransactionFactory` là singleton nhưng không giữ manager trong thuộc tính. `bind` tạo closure cho từng transaction; lời gọi `lockForBooking` dùng manager được capture:

```ts
bind(manager: EntityManager): RoomsBookingAccess {
  const assertActive = () => {
    if (!manager.queryRunner?.isTransactionActive || manager.queryRunner.isReleased) {
      throw new Error('Room access requires an active transaction');
    }
  };
  assertActive();
  return {
    lockForBooking: async (roomId) => {
      assertActive();
      const room = await manager.getRepository(RoomEntity).findOne({
        where: { id: roomId },
        lock: { mode: 'pessimistic_write' },
      });
      return room ? { id: room.id, isActive: room.isActive } : null;
    },
  };
}
```

Đoạn truy vấn biết `RoomEntity` vẫn thuộc infrastructure của Rooms. Callback Bookings chỉ thấy `RoomsBookingAccess`. Booking repository cũng kiểm tra active/released trước insert và lấy repository từ manager được truyền vào constructor. Các đối tượng này không được đăng ký singleton hoặc giữ lại sau callback.

Implementation: [RoomsTransactionFactory](../src/rooms/infrastructure/public/rooms-transaction.factory.ts) và [TypeormBookingRepository](../src/bookings/infrastructure/typeorm-booking.repository.ts).

## 5. Sử dụng callback trong application service

Sau bước đọc user, service tạo `Date` từ input và thực hiện nghiệp vụ qua các port:

```ts
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

Kiểm tra thời gian nằm sau `lockForBooking`, vì request có thể chờ khóa đến khi thời điểm bắt đầu không còn ở tương lai. Input `userId` được lấy từ kết quả Users service, không sao chép từ DTO. Callback trả `Booking`; application service không nhận `EntityManager` hoặc trả ORM entity.

## 6. Chuyển lỗi persistence sau rollback

[TypeormBookingUnitOfWork](../src/bookings/infrastructure/typeorm-booking-unit-of-work.ts) đặt `try/catch` bên ngoài `await source.transaction(...)`. TypeORM rollback khi callback ném lỗi; sau đó adapter mới chuyển lỗi constraint đã biết:

```ts
catch (error) {
  if (error instanceof QueryFailedError) {
    const pg = error.driverError as { code?: string; constraint?: string };
    if (pg.code === '23P01' && pg.constraint === 'bookings_no_overlap') {
      throw new BookingTimeConflictError();
    }
  }
  throw error;
}
```

Cần kiểm tra cả SQLSTATE và tên constraint để không biến lỗi database khác thành lỗi trùng lịch. Không bắt lỗi insert rồi tiếp tục callback như thể transaction thành công. Lỗi nghiệp vụ được exception filter ánh xạ sang HTTP; adapter không tạo `ConflictException` hoặc tự ghi response.

## 7. Map response ở HTTP boundary

Controller hồ sơ nhận principal qua decorator, gọi service và map kiểu `User` sang response DTO riêng của namespace:

```ts
async me(@CurrentPrincipal() principal: Principal): Promise<ClientUserResponseDto> {
  return ClientUserResponseDto.from(await this.users.requireBySub(principal.sub));
}
```

Handler trả DTO trực tiếp; response interceptor tạo `{ data: dto }`. Không bọc thêm `{ data }` trong controller. Admin controller dùng cùng service, nhưng map sang `AdminUserResponseDto`.

Danh sách dùng `PaginatedResponse<T>` để interceptor phân biệt với một đối tượng nghiệp vụ thông thường:

```ts
return new PaginatedResponse(rows, { page, limit, total });
// JSON: { data: rows, meta: { page, limit, total } }
```

Health dùng `RawResponse`; HTTP 204 giữ body rỗng. Cấu trúc success/error response và status code được quản lý tại [API contract](requirements.md).
