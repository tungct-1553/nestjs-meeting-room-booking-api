# Kiến trúc và bảo mật

**Trạng thái:** thiết kế làm cơ sở triển khai. Kiến trúc là một deployable NestJS modular monolith, một PostgreSQL cho dữ liệu ứng dụng. Keycloak là identity provider chạy độc lập.

## Modules và ranh giới

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| Identity | Xác thực access token Keycloak, cung cấp principal và role guard | Keycloak OIDC discovery/JWKS |
| Users | Đồng bộ hồ sơ nghiệp vụ tối thiểu theo Keycloak `sub`, cung cấp current user | Identity, Users repository |
| Rooms | Quản lý và tra cứu phòng | Identity, Rooms repository |
| Bookings | Đặt/hủy phòng, phân quyền owner, chống trùng lịch | Users, Rooms, Bookings repository |
| Shared | Config, exception filter, logging, health, utilities dùng chung | Không chứa business logic feature |

Mỗi feature có NestJS Module, Controller và Provider. Controller nhận DTO, không truy cập trực tiếp repository; application service thực thi nghiệp vụ và phụ thuộc port qua DI; infrastructure cung cấp adapter cho database. Các module không import repository nội bộ của module khác: dùng exported service hoặc port. Một tiến trình triển khai, không tách microservice.

### Cấu trúc code và dependency

Project dùng TypeORM với PostgreSQL. Port nghiệp vụ thuộc feature sử dụng nó; adapter TypeORM nằm trong infrastructure của feature. Application service không import `DataSource`, `EntityManager` hoặc ORM entity.

```text
src/
├── database/
│   ├── database.module.ts          # một DataSource/pool cho tiến trình
│   ├── database.lifecycle.ts       # đóng pool khi shutdown
│   └── migrations/
├── bookings/
│   ├── bookings.module.ts
│   ├── bookings.controller.ts
│   ├── bookings.service.ts
│   ├── ports/
│   │   ├── booking-repository.port.ts
│   │   └── booking-unit-of-work.port.ts
│   └── infrastructure/
│       ├── booking.entity.ts
│       ├── typeorm-booking.repository.ts
│       └── typeorm-booking-unit-of-work.ts
├── rooms/
│   ├── rooms.module.ts
│   ├── rooms.service.ts
│   ├── public/
│   │   └── rooms-booking-access.ts # hành vi công khai, không có kiểu ORM
│   ├── ports/
│   │   └── room-repository.port.ts
│   └── infrastructure/
│       ├── room.entity.ts
│       ├── typeorm-room.repository.ts
│       └── public/
│           └── rooms-transaction.factory.ts
└── users/                         # cùng quy ước phân lớp
```

`DatabaseModule` sở hữu kết nối và lifecycle, không chứa unit of work đặc thù booking. `BookingUnitOfWork` thuộc Bookings; implementation nằm ở infrastructure của Bookings.

### Module giao tiếp và transaction

Có hai API công khai của feature:

- API ứng dụng: service hoặc port không có kiểu ORM, ví dụ `UsersService.getOrSync(principal)` và `RoomsBookingAccess.lockForBooking(roomId)`.
- API tích hợp persistence: factory công khai của Rooms nhận `EntityManager` và trả `RoomsBookingAccess` đã gắn với transaction. Chỉ infrastructure của module khác được sử dụng factory này. Repository và entity của Rooms vẫn nội bộ.

`BookingsModule` import `UsersModule`, `RoomsModule` và `DatabaseModule`. `BookingsService` inject `UsersService` và `BookingUnitOfWork`; không gọi kiểm tra active qua service ngoài transaction. Adapter unit of work inject factory công khai của Rooms, không import `RoomEntity` hay repository nội bộ. Rooms không import Bookings hoặc mở transaction riêng khi tham gia callback của Bookings.

```text
BookingsController -> BookingsService
  -> UsersService.getOrSync(principal)               # trước transaction booking
  -> BookingUnitOfWork.run(callback)
       -> TypeORM mở transaction READ COMMITTED
       -> RoomsTransactionFactory.bind(manager)      # API infrastructure công khai
       -> callback nhận { rooms, bookings }          # port không chứa kiểu ORM
            -> rooms.lockForBooking(roomId)          # khóa phòng bằng manager đó
            -> kiểm tra active và thời gian
            -> bookings.insert(input)                # cùng manager
       -> commit hoặc rollback, trả connection về pool
```

User được upsert riêng theo `keycloak_sub` duy nhất; profile có thể tồn tại dù đặt phòng thất bại. Đây là snapshot danh tính, không cần rollback cùng booking. `userId` lấy từ kết quả đồng bộ principal đã xác thực, không lấy từ body request.

Transaction khóa dòng phòng với `pessimistic_write` trước khi kiểm tra active và insert booking. Deactivate cũng khóa cùng dòng trong transaction của Rooms. Nếu deactivate commit trước, booking thấy phòng inactive và trả 404; nếu booking giữ khóa trước, deactivate đợi booking hoàn tất và giữ nguyên booking đó. Các request đặt cùng phòng tuần tự hóa trên dòng phòng; đây là tradeoff chấp nhận cho phạm vi v1. Không gọi mạng trong khi giữ khóa.

Exclusion constraint vẫn bảo vệ khoảng thời gian `[startAt, endAt)`. Adapter unit of work chuyển riêng lỗi PostgreSQL `23P01` của constraint `bookings_no_overlap` thành lỗi nghiệp vụ; HTTP filter chuyển lỗi đó thành 409 theo error envelope. Lỗi khác được ném tiếp, không gộp mọi lỗi database thành 409.

Xem [hướng dẫn và ví dụ triển khai](implementation-patterns.md) cho DI, lifecycle, public factory của Rooms, repository gắn manager và cách gọi unit of work từ service.

## Request lifecycle

Client → routing/versioning → JWT/RBAC guard → DTO validation pipe → controller → application service/policy → repository/transaction → response serialization/interceptor. Exception filter chuyển lỗi có kiểm soát thành error response; log có request ID và context, không log token/password. Custom decorator cung cấp current principal; custom provider và lifecycle hooks được áp dụng khi phù hợp cho kết nối/đóng tài nguyên.

## Identity, token và authorization

- Keycloak sở hữu account, đăng ký, đăng nhập, reset password và refresh token; client thực hiện OIDC Authorization Code + PKCE với Keycloak. API không nhận password hay tự phát JWT. Xem [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers).
- API nhận `Authorization: Bearer`; lấy cấu hình OIDC và public keys từ issuer/JWKS, cache keys và hỗ trợ key rotation. Kiểm tra thuật toán cho phép, chữ ký, issuer, audience API, expiry và not-before; chỉ chấp nhận access token, không dùng ID/refresh token gọi API.
- Realm/client cấu hình để access token có audience API và role `admin` hoặc `employee`; role guard xác minh claim đã cấu hình. Policy/service kiểm tra owner ở server, kể cả khi request đã qua guard.
- Khi request xác thực đầu tiên vào ứng dụng, Users module upsert hồ sơ theo `sub` duy nhất từ token hợp lệ; email/display name thiếu được lưu null, không dùng email làm khóa định danh. Thay đổi quyền do Keycloak quản lý; quyền ghi nghiệp vụ vẫn do NestJS kiểm tra.
- Access token hợp lệ được xác minh offline tới khi hết hạn; không hứa revoke tức thời. TTL và refresh policy cấu hình ở Keycloak.

## Database và tính nhất quán

PostgreSQL lưu users, rooms và bookings. Migration bật `btree_gist` và tạo exclusion constraint theo room UUID và khoảng `tstzrange(start_at, end_at, '[)')` cho booking `confirmed`; `CHECK start_at < end_at`. Transaction ghi booking, map exclusion violation thành 409; không dựa duy nhất vào query kiểm tra trước khi insert. Tạo room/booking và quan hệ theo database design của project.

Pagination có thứ tự ổn định và giới hạn; index cho lookup phòng, owner và lịch. Khi cần lấy dữ liệu liên quan dùng join hoặc batch thay vì truy vấn N+1. Unit test và PostgreSQL integration test kiểm tra query, hai request đồng thời và trạng thái bị hủy.

## Phạm vi mở rộng

Phiên bản đầu không triển khai upload file, email, Bull/Redis hoặc scheduled reminder. Các kỹ năng này được nêu trong yêu cầu khóa học và chưa thuộc scope nghiệp vụ hiện tại.

## Vận hành

ConfigModule validate biến môi trường; Swagger công bố `/api/v1` và bearer auth. CORS cấu hình origin được phép; rate limiting áp dụng API phù hợp. Health endpoint phân biệt app hoạt động và dependency readiness. Enable shutdown hooks để đóng HTTP và DB đúng thứ tự. Không đưa credentials vào git; cấu hình ví dụ chỉ dùng placeholder.
