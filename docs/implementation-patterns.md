# DI và transaction

Các ví dụ trích từ implementation, lược bỏ import và các provider không liên quan. [Coding standards](coding-standards.md) quy định dependency được phép; [architecture](architecture.md) mô tả quyền sở hữu module và luồng nghiệp vụ.

## 1. Kết nối và vòng đời pool

[DatabaseModule](../src/database/database.module.ts) cung cấp một DataSource singleton cho tiến trình API. Async provider hoàn tất initialize trước khi Nest inject dependency:

```ts
{
  provide: DataSource,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new DataSource(databaseOptions(
      config.getOrThrow<string>('DATABASE_URL'),
      config.getOrThrow<number>('DB_POOL_MAX'),
    )).initialize(),
}
```

Các feature import cùng DatabaseModule; không tạo pool riêng trong service/repository. [DatabaseLifecycle](../src/database/database.lifecycle.ts) đóng pool khi shutdown:

```ts
async onApplicationShutdown(): Promise<void> {
  if (this.source.isInitialized) {
    await this.source.destroy();
  }
}
```

`main.ts` bật shutdown hooks. TypeORM CLI dùng cùng cấu hình trong tiến trình riêng; quy tắc migration và schema tại [database.md](database.md#migration-và-kết-nối).

## 2. Port nội bộ và API công khai

Users dùng hai port nội bộ cho đọc và đồng bộ. Hai token cùng trỏ tới một adapter singleton bằng `useExisting`:

```ts
// Phần providers/exports của UsersModule.
providers: [
  UsersService,
  TypeormUserRepository,
  { provide: USER_READ_REPOSITORY, useExisting: TypeormUserRepository },
  { provide: USER_SYNC_REPOSITORY, useExisting: TypeormUserRepository },
  { provide: USERS_QUERY_API, useExisting: UsersService },
],
exports: [USERS_QUERY_API],
```

[UsersQueryApi](../src/users/public/users-query.api.ts) là interface đọc cho module khác, không phải repository:

```ts
export const USERS_QUERY_API = Symbol('USERS_QUERY_API');

export interface UsersQueryApi {
  requireBySub(sub: string): Promise<User>;
}

// Constructor của BookingsService.
constructor(
  @Inject(USERS_QUERY_API) private readonly users: UsersQueryApi,
  @Inject(BOOKING_UNIT_OF_WORK) private readonly uow: BookingUnitOfWork,
) {}
```

`User`, interface và token được import từ `users/public/`. BookingsModule import UsersModule để Nest resolve token. Users service trực tiếp triển khai interface; không có facade chuyển tiếp. Token repository và concrete Users service không được export.

`requireBySub` chỉ đọc, ném `UserNotProvisionedError` khi không có hồ sơ. Bookings hoàn tất lookup này trước transaction booking; không gọi Users service trong callback rồi giả định query tự tham gia transaction hiện tại.

## 3. HTTP input và đồng bộ hồ sơ

[ClientUsersController](../src/users/presentation/client/users.controller.ts) map principal sang input thuần và trả response DTO:

```ts
@Post('sync')
@HttpCode(200)
@UseInterceptors(EmptyBodyInterceptor)
@ApiDataResponse(ClientUserResponseDto)
async sync(@CurrentPrincipal() principal: Principal): Promise<ClientUserResponseDto> {
  const user = await this.users.sync({
    sub: principal.sub,
    email: principal.email,
    displayName: principal.displayName,
    issuedAt: principal.issuedAt,
  });

  return ClientUserResponseDto.from(user);
}
```

Controller không nhận body hoặc request để kiểm tra payload. JSON/form parser thu nhận kích thước body; raw middleware của route sync đọc media type chưa được parser xử lý. Cả hai dùng giới hạn 100 KiB. [EmptyBodyInterceptor](../src/common/http/interceptors/empty-body.interceptor.ts) kiểm tra payload thực tế, chấp nhận request rỗng hoặc JSON `{}`; không suy luận sự tồn tại dữ liệu từ header chunked.

[UsersService](../src/users/application/users.service.ts) nhận `SyncUserInput`, không nhận `Principal`. Service kiểm tra `issuedAt` bằng validator NumericDate dùng chung rồi gọi port ghi:

```ts
export interface UserSyncRepositoryPort {
  upsertIfNewer(input: ProfileSyncInput): Promise<User>;
}
```

[TypeormUserRepository](../src/users/infrastructure/typeorm-user.repository.ts) thực thi contract bằng upsert có điều kiện:

```sql
ON CONFLICT (keycloak_sub) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  profile_token_iat = EXCLUDED.profile_token_iat,
  updated_at = now()
WHERE users.profile_token_iat IS NULL
   OR users.profile_token_iat < EXCLUDED.profile_token_iat
```

Adapter tự mở transaction `READ COMMITTED` cho thao tác này. Khi `RETURNING` không có row, SELECT fallback dùng snapshot mới trong cùng transaction; khóa conflict được giữ đến khi hoàn tất. Không chuyển thành SELECT rồi so sánh/UPDATE ở service. Bảo đảm UUID, watermark và retry tại [user provisioning](user-provisioning.md#3-contract-đồng-bộ).

## 4. Rooms: nghiệp vụ trong callback, SQL trong adapter

[RoomsService](../src/rooms/application/rooms.service.ts) nhận UoW qua token `ROOMS_UNIT_OF_WORK`. Service quyết định hành vi khi thiếu phòng:

```ts
async deactivate(roomId: string): Promise<void> {
  await this.uow.run(async ({ rooms }) => {
    const room = await rooms.lockById(roomId);
    if (room === null) {
      throw new RoomNotFoundError();
    }
    await rooms.setActive(room.id, false);
  });
}
```

[TypeormRoomsUnitOfWork](../src/rooms/infrastructure/typeorm-rooms-unit-of-work.ts) mở transaction và tạo repository cho callback:

```ts
return this.source.transaction('READ COMMITTED', (manager) =>
  work({ rooms: new TypeormRoomRepository(manager) }),
);
```

Repository chỉ thực hiện `lockById` và `setActive` bằng manager được bind; không ném lỗi phòng không tồn tại hoặc tự mở transaction. Thiếu row được biểu diễn bằng `null`. Deactivate phòng đã inactive vẫn thành công, không hủy booking đã có.

## 5. Bookings: transaction liên module

[BookingUnitOfWork](../src/bookings/application/ports/booking-unit-of-work.port.ts) cung cấp hai contract persistence cho callback:

```ts
export interface BookingTransaction {
  rooms: RoomsBookingAccess;
  bookings: BookingRepositoryPort;
}

export interface BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}
```

[TypeormBookingUnitOfWork](../src/bookings/infrastructure/typeorm-booking-unit-of-work.ts) tạo hai đối tượng dùng chung manager:

```ts
return await this.source.transaction('READ COMMITTED', (manager) =>
  work({
    rooms: this.roomsFactory.bind(manager),
    bookings: new TypeormBookingRepository(manager),
  }),
);
```

[RoomsTransactionFactory](../src/rooms/infrastructure/public/rooms-transaction.factory.ts) thuộc infrastructure của Rooms. Factory bind `TypeormRoomRepository` và chỉ công bố `lockForBooking`; application Bookings không thấy entity hoặc manager. Đây là điểm tích hợp persistence tường minh giữa hai module dùng cùng PostgreSQL/TypeORM.

[BookingsService](../src/bookings/application/bookings.service.ts) nhận `CreateBookingInput` chứa `actorSub` và `Date`; adapter HTTP/CLI parse dữ liệu trước khi gọi. Sau lookup user, service thực hiện:

```ts
return this.uow.run(async ({ rooms, bookings }) => {
  const room = await rooms.lockForBooking(input.roomId);
  if (room === null || !room.isActive) {
    throw new RoomUnavailableError();
  }
  if (!isValidBookingTime(input.startAt, input.endAt, Date.now())) {
    throw new InvalidBookingTimeError();
  }
  return bookings.insert({
    roomId: room.id,
    userId: user.id,
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
    status: 'confirmed',
  });
});
```

Thời gian được kiểm tra sau row lock vì request có thể phải chờ đến khi startAt không còn ở tương lai. Application chọn trạng thái; repository không tự gán `confirmed`. Row lock bảo vệ trạng thái phòng; exclusion constraint bảo vệ lịch trùng, kể cả ghi ngoài use case.

Repository Rooms/Bookings kiểm tra manager còn active trước thao tác. Không giữ chúng ngoài callback, đăng ký singleton hoặc dùng DataSource để ghi ngoài manager đang bind.

## 6. Chuyển lỗi persistence và response HTTP

Booking UoW bắt lỗi bên ngoài `await source.transaction(...)` và chỉ chuyển constraint đã biết:

```ts
if (error instanceof QueryFailedError) {
  const pg = error.driverError as { code?: string; constraint?: string };
  if (pg.code === '23P01' && pg.constraint === 'bookings_no_overlap') {
    throw new BookingTimeConflictError({ cause: error });
  }
}
throw error;
```

Lỗi khác được ném tiếp. Không bắt lỗi insert rồi tiếp tục transaction. `cause` giữ thông tin chẩn đoán nội bộ; HTTP response không chứa SQL, token hoặc driver error.

Application error định nghĩa `code` và `kind`, không có HTTP status. [ApiExceptionFilter](../src/common/http/filters/api-exception.filter.ts) map `kind` sang status; không liệt kê từng mã lỗi feature. Ví dụ `USER_NOT_PROVISIONED` thuộc kind `conflict` nên trả 409; lỗi không dự kiến trả 500 với message chung.

Controller chỉ map model thuần sang response DTO. `ApiDataResponse(Model)` đăng ký model/envelope cho Swagger; response interceptor bọc `{ data }` một lần. Danh sách được presentation chuyển sang `PaginatedResponse`; Health dùng raw response và HTTP 204 giữ body rỗng. Wire format tại [API contract](requirements.md).
