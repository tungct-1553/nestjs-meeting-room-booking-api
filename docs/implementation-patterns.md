# Ví dụ phân lớp, DI và transaction

Đây là hướng dẫn cách tổ chức code, kèm ví dụ rút gọn. Foundation và các adapter tương ứng đã có trong `src/`; xem README để chạy ứng dụng. Các đoạn dưới lược bỏ import, controller, validation DTO, mapping HTTP và khai báo entity để tập trung vào cách nối các lớp. Entity phải theo [database design](database.md); field thời gian ở lớp TypeScript dùng `Date`, HTTP serialize ISO UTC. Các kiểu/value nghiệp vụ như `Booking`, `NewBooking`, `Principal` thuộc feature sở hữu contract, không phải ORM entity. Ví dụ transaction bên dưới giữ nguyên các guard trong source; chỉ lược bỏ import và trình bày lại định dạng. Các đoạn liên quan HTTP nghiệp vụ thể hiện cách gọi sau khi có guard; hiện chỉ core service được gọi nội bộ.

## 1. Một pool, một nơi sở hữu lifecycle

Chọn custom async provider của NestJS để sở hữu `DataSource`; không đồng thời đăng ký `TypeOrmModule.forRoot()` hoặc thêm một nơi khác gọi `destroy()`. App import `ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment })` trước khi sử dụng cấu hình. Hàm `validateEnvironment` yêu cầu `DATABASE_URL`, chuyển `DB_POOL_MAX` thành integer dương (mặc định 10). Ví dụ dùng glob theo layout build thông thường `src` → `dist`, chỉ chạy một cây source hoặc build mỗi lần.

```ts
// database/database.module.ts
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const source = new DataSource({
          type: 'postgres',
          url: config.getOrThrow<string>('DATABASE_URL'),
          extra: { max: config.getOrThrow<number>('DB_POOL_MAX') },
          entities: [join(__dirname, '..', '**', 'infrastructure', '*.entity.{ts,js}')],
          migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
          synchronize: false,
          migrationsRun: false,
          logging: false,
          installExtensions: false,
        });
        return source.initialize();
      },
    },
    DatabaseLifecycle,
  ],
  exports: [DataSource],
})
export class DatabaseModule {}

// database/database.lifecycle.ts
@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly source: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.source.isInitialized) await this.source.destroy();
  }
}

// main.ts: sau NestFactory.create(AppModule)
app.enableShutdownHooks();
await app.listen(port);
```

Các module import cùng `DatabaseModule` tĩnh để dùng chung provider singleton. Kết nối lỗi làm bootstrap thất bại; không tiếp tục chạy với database chưa sẵn sàng. CLI migration là tiến trình riêng: `src/database/data-source.ts` export DataSource chưa initialize, dùng chung hàm `databaseOptions` với app. Lệnh TypeORM CLI trong package scripts sở hữu initialize/destroy của DataSource này. File export không tự mở kết nối, không viết thêm lifecycle provider cho CLI và không mở pool CLI trong tiến trình HTTP. Migration chạy riêng trước khi triển khai, không dùng synchronize thay migration.

Theo [DataSource API của TypeORM](https://typeorm.io/docs/data-source/data-source-api/), `initialize()` mở pool và `destroy()` đóng các kết nối. [NestJS lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events) mô tả shutdown hook cho signal và `app.close()`.

## 2. Contract ứng dụng và API tích hợp công khai

`BookingUnitOfWork` do Bookings sở hữu. Callback chỉ nhận các hành vi cần dùng, không nhận `EntityManager` hay ORM entity.

```ts
// rooms/public/rooms-booking-access.ts
export interface RoomsBookingAccess {
  lockForBooking(roomId: string): Promise<{
    id: string;
    isActive: boolean;
  } | null>;
}

// bookings/ports/booking-repository.port.ts
export interface NewBooking {
  roomId: string;
  userId: string;
  title: string;
  startAt: Date;
  endAt: Date;
}
export interface Booking extends NewBooking {
  id: string;
  status: 'confirmed' | 'cancelled';
  createdAt: Date;
}
export interface BookingRepositoryPort {
  insert(input: NewBooking): Promise<Booking>;
}

// bookings/ports/booking-unit-of-work.port.ts
export const BOOKING_UNIT_OF_WORK = Symbol('BOOKING_UNIT_OF_WORK');
export interface BookingTransaction {
  rooms: RoomsBookingAccess;
  bookings: BookingRepositoryPort;
}
export interface BookingUnitOfWork {
  run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T>;
}
```

`RoomsBookingAccess` là contract công khai của Rooms. Repository port của Rooms vẫn nội bộ. Factory dưới đây là API tích hợp persistence công khai: infrastructure của Bookings được import factory này; service/controller của Bookings chỉ dùng contract không có kiểu ORM.

```ts
// rooms/infrastructure/public/rooms-transaction.factory.ts
@Injectable()
export class RoomsTransactionFactory {
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
}
```

Đây là nơi duy nhất trong luồng booking biết `RoomEntity`. Factory không lưu manager vào thuộc tính singleton, không mở transaction, không commit và không trả entity ra ngoài. Đối tượng trả về chỉ tồn tại trong callback, không được cache hoặc sử dụng sau commit/rollback. Không kích hoạt eager/lazy relation trong truy vấn khóa; chỉ đọc dòng phòng cần thiết.

## 3. Adapter gắn cùng manager và điều phối transaction

```ts
// bookings/infrastructure/typeorm-booking.repository.ts
export class TypeormBookingRepository implements BookingRepositoryPort {
  constructor(private readonly manager: EntityManager) {}

  async insert(input: NewBooking): Promise<Booking> {
    if (!this.manager.queryRunner?.isTransactionActive || this.manager.queryRunner.isReleased) {
      throw new Error('Booking insert requires an active transaction');
    }
    const repository = this.manager.getRepository(BookingEntity);
    const row = await repository.save(repository.create({
      ...input,
      status: 'confirmed',
    }));
    return {
      id: row.id, roomId: row.roomId, userId: row.userId,
      title: row.title, startAt: row.startAt, endAt: row.endAt,
      status: row.status, createdAt: row.createdAt,
    };
  }
}

// bookings/infrastructure/typeorm-booking-unit-of-work.ts
@Injectable()
export class TypeormBookingUnitOfWork implements BookingUnitOfWork {
  constructor(
    @Inject(DataSource) private readonly source: DataSource,
    private readonly roomsFactory: RoomsTransactionFactory,
  ) {}

  async run<T>(work: (tx: BookingTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.source.transaction('READ COMMITTED', (manager) => {
        return work({
          rooms: this.roomsFactory.bind(manager),
          bookings: new TypeormBookingRepository(manager),
        });
      });
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
}
```

Hai thao tác khóa phòng và insert booking dùng cùng `manager`. Adapter repository này được tạo cho từng transaction bằng constructor; không đăng ký thành singleton sử dụng manager toàn cục. DataSource, factory và adapter unit of work là singleton; services và adapter repository Users/Rooms cũng là singleton dùng DataSource được inject. Riêng booking repository và đối tượng Rooms access được tạo theo transaction, không đăng ký singleton. `DataSource.transaction` commit khi callback thành công, rollback khi callback ném lỗi và giải phóng connection. Không bắt rồi nuốt lỗi insert trong callback; việc chuyển lỗi nằm ngoài transaction để rollback hoàn tất trước.

Quy tắc dùng manager của callback được quy định trong [TypeORM transactions](https://typeorm.io/docs/transactions/). Exclusion constraint phải có tên `bookings_no_overlap` trong migration. `BookingTimeConflictError` và `RoomUnavailableError` là lỗi ứng dụng; HTTP exception filter ánh xạ lần lượt 409 và 404 theo error envelope, không trả thông tin driver cho client.

## 4. DI và cách dùng từ application service

Các đoạn module dưới thể hiện provider/import/export hiện tại liên quan transaction. Rooms đã export service deactivate và factory; Users export service đồng bộ profile. Controller CRUD sẽ được thêm cùng xác thực; entity/repository nội bộ không được export.

```ts
// rooms/rooms.module.ts
@Module({
  imports: [DatabaseModule],
  providers: [
    RoomsService,
    RoomsTransactionFactory,
    { provide: ROOM_REPOSITORY, useClass: TypeormRoomRepository },
  ],
  exports: [RoomsService, RoomsTransactionFactory],
})
export class RoomsModule {}

// bookings/bookings.module.ts
@Module({
  imports: [DatabaseModule, UsersModule, RoomsModule],
  providers: [
    BookingsService,
    {
      provide: BOOKING_UNIT_OF_WORK,
      useClass: TypeormBookingUnitOfWork,
    },
  ],
  exports: [BookingsService],
})
export class BookingsModule {}

// bookings/bookings.service.ts
@Injectable()
export class BookingsService {
  constructor(
    private readonly users: UsersService,
    @Inject(BOOKING_UNIT_OF_WORK) private readonly uow: BookingUnitOfWork,
  ) {}

  async create(principal: Principal, dto: CreateBookingDto): Promise<Booking> {
    const user = await this.users.getOrSync(principal);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    return this.uow.run(async ({ rooms, bookings }) => {
      const room = await rooms.lockForBooking(dto.roomId);
      if (!room?.isActive) throw new RoomUnavailableError();

      // Kiểm tra lại sau khi chờ khóa để startAt vẫn ở tương lai.
      if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())
        || startAt.getTime() <= Date.now() || startAt >= endAt) {
        throw new InvalidBookingTimeError();
      }
      return bookings.insert({
        roomId: room.id, userId: user.id, title: dto.title, startAt, endAt,
      });
    });
  }
}
```

`UsersModule` export `UsersService`; `getOrSync` upsert theo `keycloak_sub` UNIQUE và trả UUID user ứng dụng. Nó chạy trước transaction booking, không giữ connection booking trong lúc đồng bộ hồ sơ. Profile được giữ khi booking rollback. Guard cung cấp principal đã xác thực; DTO không có `userId` và được validate timezone/date trước khi vào service. `InvalidBookingTimeError` được filter ánh xạ 400. Các `interface` dùng `import type`; DI token dùng import giá trị để NestJS inject đúng provider. Cách đăng ký `useClass` và inject token theo [NestJS custom providers](https://docs.nestjs.com/fundamentals/custom-providers).

Read use case của v1 được cung cấp qua service công khai của feature và trả DTO/value nghiệp vụ. Hiện `RoomsService` chỉ có `deactivate`, chưa có phương thức read. Khi cần transaction dùng nhiều module, gọi bộ port trong callback trên; không gọi service mở transaction độc lập hoặc đọc bằng manager mặc định giữa callback.

## 5. Deactivate dùng cùng quy tắc khóa

Rooms sở hữu transaction của thao tác deactivate. `RoomsService` gọi repository port nội bộ; adapter TypeORM của Rooms thực hiện đoạn sau bằng DataSource được inject. Đây là transaction riêng của lời gọi `RoomsService.deactivate`; khi mở HTTP nghiệp vụ, controller admin sẽ gọi service này. Transaction đó không chạy bên trong transaction booking.

```ts
// Bên trong TypeormRoomRepository.deactivate(roomId)
await this.source.transaction('READ COMMITTED', async (manager) => {
  const repository = manager.getRepository(RoomEntity);
  const room = await repository.findOne({
    where: { id: roomId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!room) throw new RoomNotFoundError();
  await repository.update(room.id, { isActive: false });
});
```

`RoomNotFoundError` ánh xạ 404. Nếu phòng đã inactive thì core service vẫn hoàn tất bình thường; HTTP contract `DELETE /rooms/:id` quy định trả 204 khi controller được triển khai. Khi booking giữ khóa trước, deactivate đợi rồi cập nhật; booking được giữ. Khi deactivate commit trước, core booking lấy khóa sau sẽ thấy inactive và ném `RoomUnavailableError`; filter ánh xạ lỗi này thành 404 khi có HTTP controller. Các booking cùng phòng cũng chờ khóa, nên transaction cần ngắn, không gọi Keycloak, HTTP hay xử lý việc khác trong callback. Request khác phòng có thể xử lý đồng thời.

## 6. Response contract

`ResponseEnvelopeInterceptor` hiện hỗ trợ đối tượng đơn, phân trang, raw health và HTTP 204. Handler danh sách dùng kiểu công khai `PaginatedResponse<T>`; interceptor nhận diện instance, không đoán cấu trúc object.

```ts
// Handler danh sách v1; rows/meta do service cung cấp sau khi có API nghiệp vụ.
return new PaginatedResponse(rows, { page, limit, total });
// JSON: { "data": [...], "meta": { "page": 1, "limit": 20, "total": 0 } }
```

Đối tượng đơn trả trực tiếp từ handler để interceptor tạo `{ data: object }`; handler không tự bọc thêm `{ data }`. Health dùng `RawResponse`; 204 có body rỗng. Error filter tạo envelope lỗi theo [requirements](requirements.md).

## 7. Các kiểm chứng hiện có và đầu việc còn lại

`test/foundation.spec.ts`, `test/unit-of-work.spec.ts`, `test/bookings.service.spec.ts` và `test/booking.integration.spec.ts` đã kiểm chứng các kịch bản dưới đây. Integration chạy bằng PostgreSQL thật trong schema test riêng; unit test của lifecycle và HTTP error mapping không thay thế việc kiểm chứng mọi thao tác vận hành production.

- Unit test service với unit of work giả: phòng không tồn tại/inactive trả lỗi; userId lấy từ principal; thời gian được kiểm tra sau khi lấy khóa.
- Unit test DI/module: token resolve đúng adapter; factory Rooms được export; không cần import entity/repository Rooms từ Bookings.
- PostgreSQL integration: hai request cùng phòng và giờ chỉ một thành công; thời gian liền nhau hợp lệ; cancelled không giữ lịch. Kiểm tra constraint trực tiếp bằng hai transaction insert không qua khóa service để xác nhận bảo vệ tại DB.
- PostgreSQL integration với điều phối thứ tự khóa: deactivate giữ khóa trước thì booking bị từ chối; booking giữ khóa trước thì booking thành công và deactivate giữ lịch sử.
- Gây lỗi sau insert để kiểm tra rollback; xác nhận không ghi vào connection mặc định, không sử dụng transaction object sau callback, và request kế tiếp vẫn dùng được pool.
- Unit test xác nhận lifecycle không đóng pool lần hai khi pool đã đóng; HTTP test gọi `app.close()` khi cleanup. Unit test lỗi kiểm tra `23P01`/`bookings_no_overlap` được map đúng và lỗi FK `23503` được ném tiếp.

CHECK/FK/index cần thêm test trực tiếp khi mở rộng query CRUD/list; Keycloak/JWT/RBAC và owner policy HTTP cần kiểm thử khi triển khai Identity và controller nghiệp vụ. Các đầu việc đó chưa được coi là hoàn thành chỉ vì foundation đã chạy được.
