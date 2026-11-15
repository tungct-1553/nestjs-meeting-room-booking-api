# Kiến trúc

NestJS modular monolith, PostgreSQL và Keycloak. Ứng dụng tổ chức theo feature; mỗi feature gồm Module, Controller, Provider và adapter persistence.

## Module

| Module/thư mục | Trách nhiệm | API công khai |
|---|---|---|
| Identity | Xác thực access token Keycloak, cung cấp principal và RBAC guard | `Principal`, guard xác thực/phân quyền |
| Users | Đồng bộ hồ sơ theo Keycloak `sub` | `UsersService` |
| Rooms | Quản lý phòng và khóa phòng trong transaction booking | `RoomsService`, `RoomsBookingAccess`, `RoomsTransactionFactory` |
| Bookings | Tạo, tra cứu, hủy booking và kiểm tra owner | `BookingsService` |
| Database | DataSource, connection pool, lifecycle và migration | `DataSource` |
| Health | Liveness và database readiness | HTTP health endpoints |
| `common/`, `config/` | DTO/type dùng chung, HTTP filter/interceptor, logging và cấu hình | Thành phần hạ tầng dùng chung |

## Phân lớp

```text
src/
├── common/
├── config/
├── database/
│   └── migrations/
├── health/
├── identity/
├── users/
├── rooms/
│   ├── public/
│   ├── ports/
│   └── infrastructure/
│       └── public/
└── bookings/
    ├── dto/
    ├── ports/
    └── infrastructure/
```

- Controller nhận DTO và gọi application service. Service nghiệp vụ không phụ thuộc `DataSource`, `EntityManager` hoặc ORM entity.
- Port thuộc feature sở hữu hành vi. `RoomsBookingAccess` thuộc Rooms; `BookingUnitOfWork` và booking repository port thuộc Bookings.
- Adapter TypeORM triển khai port và được đăng ký bằng DI token. Repository/entity là nội bộ của feature.
- Giao tiếp giữa các feature qua service hoặc port công khai. Infrastructure của Bookings sử dụng `RoomsTransactionFactory` để tham gia transaction; factory này là API persistence công khai của Rooms.
- `BookingsModule` import Users, Rooms và Database. Rooms không phụ thuộc Bookings. Health truy vấn DataSource trực tiếp để kiểm tra readiness.

## Transaction

`BookingsService.create` điều phối luồng đặt phòng:

1. Upsert user theo `principal.sub` qua `UsersService.getOrSync`, lấy UUID `users.id`.
2. Gọi `BookingUnitOfWork.run`; adapter mở transaction `READ COMMITTED`.
3. Bind Rooms access và booking repository vào cùng `EntityManager`.
4. Khóa dòng phòng bằng `SELECT ... FOR UPDATE`, kiểm tra active và thời gian booking.
5. Insert booking; commit khi callback thành công, rollback khi callback ném lỗi.

User upsert nằm ngoài transaction booking; profile được giữ nếu booking thất bại. Các port gắn transaction chỉ được sử dụng trong callback. Factory và repository kiểm tra transaction active/released trước mỗi thao tác. Không gọi mạng hoặc mở transaction độc lập trong callback.

Deactivate phòng sử dụng transaction của Rooms và khóa cùng dòng phòng. Nếu deactivate commit trước, booking ném `RoomUnavailableError`; nếu booking giữ khóa trước, deactivate chờ booking hoàn tất. Các request đặt cùng phòng được tuần tự hóa; request khác phòng có thể xử lý đồng thời.

Constraint `bookings_no_overlap` bảo vệ trùng lịch ở PostgreSQL. Adapter unit of work chuyển riêng lỗi `23P01` của constraint này thành `BookingTimeConflictError`; các lỗi khác được ném tiếp. HTTP filter ánh xạ lỗi nghiệp vụ theo [API contract](requirements.md).

## Request lifecycle

Middleware request ID/logging → routing → JWT/RBAC guard → interceptor trước handler → validation pipe → controller → service/persistence → response interceptor → JSON.

Exception filter chuẩn hóa lỗi. Owner policy nằm trong application service. Middleware ghi request ID, method, status và duration; không ghi token, password, body hoặc query string. Thứ tự xử lý theo [NestJS request lifecycle](https://docs.nestjs.com/faq/request-lifecycle).

## Xác thực và phân quyền

- Keycloak quản lý tài khoản, đăng ký, đăng nhập, reset password và refresh token. Client sử dụng Authorization Code + PKCE; API không nhận password hoặc phát token.
- API xác minh access token qua issuer/JWKS, kiểm tra chữ ký, thuật toán cho phép, issuer, audience, expiry và not-before. JWKS được cache và hỗ trợ key rotation. ID token và refresh token không được dùng gọi API.
- Role lấy từ `resource_access[API_CLIENT_ID].roles`, gồm `admin` và `employee`. `API_CLIENT_ID` là client của API trong Keycloak và phải có trong audience. Admin có quyền Employee; owner policy áp dụng cho cả hai role.
- Principal lấy từ token đã xác minh. User ứng dụng được đồng bộ khi use case gọi `UsersService.getOrSync`; `sub` ánh xạ tới `users.keycloak_sub`, UUID `users.id` dùng làm khóa ngoại booking.
- Access token được xác minh offline đến khi hết hạn. TTL và refresh policy cấu hình ở Keycloak.

Tham khảo [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers) và [token role mappings](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/clients/oidc/con-token-role-mappings.adoc).

[Schema và migration](database.md) · [Ví dụ DI và transaction](implementation-patterns.md)
