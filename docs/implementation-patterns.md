# Ví dụ phân lớp, DI và transaction

Đây là hướng dẫn cho code sẽ dựng, chưa phải mã ứng dụng chạy được. Các đoạn dưới lược bỏ import, controller, validation DTO, mapping HTTP và khai báo entity để tập trung vào cách nối các lớp. Entity phải theo [database design](database.md); field thời gian ở lớp TypeScript dùng `Date`, HTTP serialize ISO UTC. Các kiểu/value nghiệp vụ như `Booking`, `NewBooking`, `Principal` thuộc feature, không phải ORM entity.

## 1. Một pool, một nơi sở hữu lifecycle

Chọn custom async provider của NestJS để sở hữu `DataSource`; không đồng thời đăng ký `TypeOrmModule.forRoot()` hoặc thêm một nơi khác gọi `destroy()`. App import `ConfigModule.forRoot({ isGlobal: true, validate })` trước khi sử dụng cấu hình. Hàm `validate` yêu cầu `DATABASE_URL`, chuyển `DB_POOL_MAX` thành integer dương (mặc định 10). Ví dụ dùng glob theo layout build thông thường `src` → `dist`, chỉ chạy một cây source hoặc build mỗi lần.

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

Các module import cùng `DatabaseModule` tĩnh để dùng chung provider singleton. Kết nối lỗi làm bootstrap thất bại; không tiếp tục chạy với database chưa sẵn sàng. CLI migration là tiến trình riêng: dùng cùng cách dựng options, tự initialize/destroy trong `try/finally`, không mở thêm pool CLI bên trong tiến trình HTTP. Migration chạy riêng trước khi triển khai, không dùng synchronize thay migration.

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
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Rooms access requires an active transaction');
    }
    return {
      lockForBooking: async (roomId) => {
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

Hai thao tác khóa phòng và insert booking dùng cùng `manager`. Adapter repository này được tạo cho từng transaction bằng constructor; không đăng ký thành singleton sử dụng manager toàn cục. Singleton chỉ gồm DataSource, factory và adapter unit of work. `DataSource.transaction` commit khi callback thành công, rollback khi callback ném lỗi và giải phóng connection. Không bắt rồi nuốt lỗi insert trong callback; việc chuyển lỗi nằm ngoài transaction để rollback hoàn tất trước.

Quy tắc dùng manager của callback được quy định trong [TypeORM transactions](https://typeorm.io/docs/transactions/). Exclusion constraint phải có tên `bookings_no_overlap` trong migration. `BookingTimeConflictError` và `RoomUnavailableError` là lỗi ứng dụng; HTTP exception filter ánh xạ lần lượt 409 và 404 theo error envelope, không trả thông tin driver cho client.

## 4. DI và cách dùng từ application service

Các đoạn module dưới minh họa phần provider/import/export liên quan transaction. Provider/controller CRUD riêng của Rooms và Bookings được thêm khi triển khai các API đó; không export entity hoặc repository nội bộ.

```ts
// rooms/rooms.module.ts
@Module({
  providers: [RoomsTransactionFactory],
  exports: [RoomsTransactionFactory],
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
      if (startAt.getTime() <= Date.now() || startAt >= endAt) {
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

Với read use case đơn giản, module có thể export service như `RoomsService` nhận room ID và trả DTO/value nghiệp vụ. Khi cần transaction dùng nhiều module, gọi bộ port trong callback trên; không gọi service mở transaction độc lập hoặc đọc bằng manager mặc định giữa callback.

## 5. Deactivate dùng cùng quy tắc khóa

Rooms sở hữu transaction của thao tác deactivate. `RoomsService` gọi repository port nội bộ; adapter TypeORM của Rooms thực hiện đoạn sau bằng DataSource được inject. Đây là transaction riêng của một request admin, không chạy bên trong transaction booking.

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

`RoomNotFoundError` ánh xạ 404. Nếu phòng đã inactive thì thao tác vẫn trả 204. Khi booking giữ khóa trước, deactivate đợi rồi cập nhật; booking được giữ. Khi deactivate commit trước, booking lấy khóa sau sẽ thấy inactive và trả 404. Các booking cùng phòng cũng chờ khóa, nên transaction cần ngắn, không gọi Keycloak, HTTP hay xử lý việc khác trong callback. Request khác phòng có thể xử lý đồng thời.

## 6. Các kịch bản cần kiểm chứng khi có code

- Unit test service với unit of work giả: phòng không tồn tại/inactive trả lỗi; userId lấy từ principal; thời gian được kiểm tra sau khi lấy khóa.
- Unit test DI/module: token resolve đúng adapter; factory Rooms được export; không cần import entity/repository Rooms từ Bookings.
- PostgreSQL integration: hai request cùng phòng và giờ chỉ một thành công; thời gian liền nhau hợp lệ; cancelled không giữ lịch. Kiểm tra constraint trực tiếp bằng hai transaction insert không qua khóa service để xác nhận bảo vệ tại DB.
- PostgreSQL integration với điều phối thứ tự khóa: deactivate giữ khóa trước thì booking bị từ chối; booking giữ khóa trước thì booking thành công và deactivate giữ lịch sử.
- Gây lỗi sau insert để kiểm tra rollback; xác nhận không ghi vào connection mặc định, không sử dụng transaction object sau callback, và request kế tiếp vẫn dùng được pool.
- Kiểm tra shutdown/`app.close()` đóng pool một lần; lỗi khác `23P01`/`bookings_no_overlap` không bị chuyển nhầm thành booking trùng lịch.
