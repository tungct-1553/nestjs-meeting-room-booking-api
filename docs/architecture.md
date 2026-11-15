# Kiến trúc và bảo mật

**Trạng thái:** đã triển khai foundation NestJS và core transaction TypeORM. Kiến trúc gồm một ứng dụng modular monolith và một PostgreSQL cho dữ liệu ứng dụng. Keycloak là identity provider độc lập theo mục tiêu v1; verifier, guard, RBAC và các HTTP controller nghiệp vụ chưa được triển khai. HTTP hiện tại chỉ có health/readiness và Swagger.

## Quy ước tài liệu

| Tài liệu | Nội dung quản lý |
|---|---|
| [Requirements](requirements.md) | Quy tắc nghiệp vụ, quyền và HTTP contract v1; ghi rõ endpoint hiện có |
| Tài liệu này | Ranh giới module, DI, request lifecycle và quy tắc phối hợp transaction |
| [Database](database.md) | Schema, constraint, index, quản lý migration và kết nối |
| [Ví dụ triển khai](implementation-patterns.md) | Ví dụ sử dụng các contract đã chốt, đối chiếu với code trong `src/` |
| [README](../README.md) | Cách chạy và khả năng hiện có |
| [Roadmap](roadmap.md) | Các đầu việc còn lại và tiêu chí hoàn thành |

Schema thực tế do migration SQL quyết định. Nếu code khác HTTP contract hoặc quy tắc kiến trúc đã chốt, phải ghi nhận và sửa sai lệch; không tự coi code là thay đổi requirement. Ví dụ rút gọn phải giữ nguyên dependency, transaction và kiểm tra an toàn của implementation.

## Modules và ranh giới

| Module/thư mục | Trách nhiệm và trạng thái hiện tại | Dependency hiện tại |
|---|---|---|
| Identity | Module rỗng và kiểu `Principal`; xác thực Keycloak/RBAC là mục tiêu v1 | Không có provider xác thực |
| Users | Upsert hồ sơ theo `sub`, export `UsersService` | Database; kiểu principal công khai của Identity |
| Rooms | Core deactivate, export `RoomsService` và `RoomsTransactionFactory` | Database, repository nội bộ |
| Bookings | Core create, sở hữu `BookingUnitOfWork`, export `BookingsService` | Users, Rooms, Database |
| Database | DataSource/pool, lifecycle, options và CLI migration | Config, TypeORM/PostgreSQL |
| Health | Controller liveness/readiness | Database; được phép truy vấn readiness trực tiếp |
| `common/`, `config/` | HTTP filter/interceptor, logging, DTO/type dùng chung và cấu hình | Không chứa nghiệp vụ feature; không có `SharedModule` riêng |

Feature đã có NestJS Module và Provider. HTTP controller nghiệp vụ chỉ được thêm cùng guard xác thực/phân quyền; hiện chỉ Health có controller. Controller nhận DTO rồi gọi service; service Users/Rooms/Bookings không truy cập ORM trực tiếp. Repository nội bộ không được module khác import. Factory persistence công khai của Rooms là điểm tích hợp transaction được nêu dưới đây.

### Cấu trúc code và dependency

Project dùng TypeORM với PostgreSQL. Port thuộc feature sở hữu hành vi; `RoomsBookingAccess` thuộc Rooms, `BookingUnitOfWork` và booking repository port thuộc Bookings; adapter TypeORM nằm trong infrastructure của feature. Application service của Users/Rooms/Bookings không import `DataSource`, `EntityManager` hoặc ORM entity.

Cây dưới mô tả các thành phần hiện có liên quan persistence; controller nghiệp vụ chưa có trong cây code.

```text
src/
├── database/
│   ├── database.module.ts          # một DataSource/pool cho tiến trình
│   ├── database.lifecycle.ts       # đóng pool khi shutdown
│   └── migrations/
├── bookings/
│   ├── bookings.module.ts
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
Caller nội bộ -> BookingsService
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

Hiện `BookingsService.create` gọi upsert mỗi lần trước transaction booking. User được upsert riêng theo `keycloak_sub` duy nhất; profile có thể tồn tại dù đặt phòng thất bại. Đây là snapshot danh tính, không cần rollback cùng booking. `userId` lấy từ kết quả đồng bộ principal đã xác thực, không lấy từ body request.

Transaction khóa dòng phòng với `pessimistic_write` trước khi kiểm tra active và insert booking. Deactivate cũng khóa cùng dòng trong transaction của Rooms. Nếu deactivate commit trước, core booking thấy phòng inactive và ném `RoomUnavailableError` (filter ánh xạ 404 khi có HTTP controller); nếu booking giữ khóa trước, deactivate đợi booking hoàn tất và giữ nguyên booking đó. Các request đặt cùng phòng tuần tự hóa trên dòng phòng; đây là tradeoff chấp nhận cho phạm vi v1. Không gọi mạng trong khi giữ khóa.

Exclusion constraint vẫn bảo vệ khoảng thời gian `[startAt, endAt)`. Adapter unit of work chuyển riêng lỗi PostgreSQL `23P01` của constraint `bookings_no_overlap` thành lỗi nghiệp vụ; HTTP filter chuyển lỗi đó thành 409 theo error envelope. Lỗi khác được ném tiếp, không gộp mọi lỗi database thành 409.

Xem [hướng dẫn và ví dụ triển khai](implementation-patterns.md) cho DI, lifecycle, public factory của Rooms, repository gắn manager và cách gọi unit of work từ service.

## Request lifecycle

Luồng HTTP hiện tại: middleware request ID/logging → routing với prefix `/api/v1` → interceptor trước handler → validation pipe → controller/service → interceptor bọc response → JSON response. Health dùng `RawResponse`; đối tượng đơn được bọc `{ data }`; danh sách dùng `PaginatedResponse<T>` để trả `{ data, meta }`; HTTP 204 không có body. Exception filter chuyển lỗi thành error envelope theo [HTTP contract](requirements.md).

Luồng HTTP nghiệp vụ mục tiêu v1 bổ sung JWT/RBAC guard trước interceptor/pipe; owner policy nằm trong application service. Guard tạo principal từ token đã xác minh; controller lấy principal đó để gọi service. Không nhận principal từ body, header tự khai báo danh tính hoặc query.

Thứ tự guard/interceptor/pipe tuân theo [NestJS request lifecycle](https://docs.nestjs.com/faq/request-lifecycle). Middleware ghi request ID, method, status và duration; không log token, password, body hoặc query string. Readiness được phép truy vấn database trực tiếp, còn application service nghiệp vụ chỉ dùng port/service công khai.

## Identity, token và authorization — mục tiêu v1

Các quy tắc sau là yêu cầu cho bước Identity, chưa phải khả năng của module rỗng hiện tại. Giá trị issuer và API client ID được cung cấp theo môi trường triển khai.

- Keycloak sở hữu account, đăng ký, đăng nhập, reset password và refresh token; client thực hiện OIDC Authorization Code + PKCE với Keycloak. API không nhận password hay tự phát JWT. Xem [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers).
- API nhận `Authorization: Bearer`; lấy cấu hình OIDC và public keys từ issuer/JWKS, cache keys và hỗ trợ key rotation. Kiểm tra thuật toán cho phép, chữ ký, issuer, audience API, expiry và not-before; chỉ chấp nhận access token, không dùng ID/refresh token gọi API.
- Quyết định mục tiêu v1 cho bước Identity: dùng client roles `admin`/`employee` tại `resource_access[API_CLIENT_ID].roles`. `API_CLIENT_ID` là client của API theo môi trường; sẽ được thêm vào cấu hình khi triển khai Identity, chưa phải biến foundation hiện có. Keycloak phải đưa client này vào audience của access token. Guard lấy role từ đúng client đó; `admin` có các quyền Employee theo requirements. Service kiểm tra owner dù request đã qua guard. Cấu trúc client-role claim theo [Keycloak token role mappings](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/clients/oidc/con-token-role-mappings.adoc).
- Luồng nghiệp vụ cần user ứng dụng gọi `UsersService.getOrSync(principal)` trước transaction ghi nghiệp vụ. Hiện core create booking đã gọi bước này; `/users/me` sẽ gọi cùng service khi controller được triển khai. Không có cơ chế tự động upsert mọi request ở middleware/guard. `sub` là khóa đối chiếu danh tính; kết quả upsert cung cấp UUID `users.id` để dùng làm `bookings.user_id`. Email/display name thiếu được lưu null, không dùng email làm khóa định danh. Keycloak quản lý role; NestJS kiểm tra quyền thao tác và owner.
- Access token hợp lệ được xác minh offline tới khi hết hạn; không hứa revoke tức thời. TTL và refresh policy cấu hình ở Keycloak.

## Database và tính nhất quán

PostgreSQL lưu users, rooms và bookings. Migration bật `btree_gist` và tạo exclusion constraint theo room UUID và khoảng `tstzrange(start_at, end_at, '[)')` cho booking `confirmed`; `CHECK start_at < end_at`. Transaction ghi booking, map exclusion violation thành 409; không dựa duy nhất vào query kiểm tra trước khi insert. Tạo room/booking và quan hệ theo database design của project.

Danh sách HTTP chưa được triển khai; contract phân trang được quản lý ở [requirements](requirements.md), index hiện có ở [database](database.md). Khi triển khai truy vấn liên quan nhiều feature, adapter dùng API công khai/batch; application service không truy cập repository/entity nội bộ của feature khác. Bộ integration test PostgreSQL hiện kiểm tra migration, booking đồng thời, lịch liền nhau/cancelled, rollback và thứ tự khóa với deactivate.

## Phạm vi mở rộng

Phiên bản đầu không triển khai upload file, email, Bull/Redis hoặc scheduled reminder. Các kỹ năng này được nêu trong yêu cầu khóa học và chưa thuộc scope nghiệp vụ hiện tại.

## Vận hành

Hiện ConfigModule validate `DATABASE_URL`, `PORT`, `DB_POOL_MAX` và `CORS_ORIGINS`; giá trị mặc định và lệnh chạy ở [README](../README.md). Swagger UI ở `/api/v1/docs`, OpenAPI JSON ở `/api/v1/docs-json`; khai báo bearer scheme chỉ mô tả contract, không cung cấp xác thực. CORS dùng allowlist. Rate limiting chưa được triển khai và được theo dõi ở roadmap. Health/readiness public tại `/api/v1/health` và `/api/v1/health/ready`. Shutdown hooks đóng HTTP trước lifecycle đóng DataSource; CLI migration có vòng đời tiến trình riêng. Credentials không được đưa vào git; `.env.example` chỉ dùng placeholder.
