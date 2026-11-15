# Meeting Room Booking API

Mock Project backend đặt phòng họp, xây dựng bằng NestJS theo kiến trúc **modular monolith**. Mục tiêu v1: nhân viên xem phòng, đặt và hủy lịch của mình; admin quản lý phòng. Keycloak phụ trách tài khoản và xác thực.

Trạng thái: **đã có foundation NestJS và các adapter transaction TypeORM**. HTTP hiện công khai health/readiness và Swagger; Keycloak guard, RBAC và các HTTP API nghiệp vụ sẽ được triển khai tiếp. Core service nhận principal từ caller nội bộ; chưa có HTTP nghiệp vụ cho client tự gửi principal/userId.

## Tài liệu

- [Requirements và API contract](docs/requirements.md)
- [Kiến trúc và bảo mật](docs/architecture.md)
- [Ví dụ phân lớp, DI và transaction](docs/implementation-patterns.md)
- [Thiết kế database](docs/database.md) · [Sơ đồ draw.io](docs/database.drawio)
- [Roadmap và mục tiêu học tập](docs/roadmap.md)

## Phạm vi

Room management, booking chống trùng lịch, RBAC, unit test và e2e test. Phiên bản đầu không có upload ảnh, notification, approval workflow, thanh toán hoặc frontend.

API contract và database design là cơ sở triển khai, được cập nhật khi có thay đổi nghiệp vụ.

## Chạy local

Yêu cầu Node.js 22 trở lên, npm và PostgreSQL 14 trở lên. Tài khoản database cần quyền tạo extension `btree_gist` ở bước migration (hoặc DBA cài extension trước). Runtime không tự synchronize schema hay chạy migration.

Migration SQL viết tay là nguồn sự thật của schema; `synchronize` giữ `false`. Chưa hỗ trợ `migration:generate` vì metadata entity chưa phản ánh đầy đủ FK, exclusion constraint và UUID defaults. Khi đổi migration, review các constraint/index/default và chạy PostgreSQL integration tests; xem [database design](docs/database.md).

```bash
npm ci
cp .env.example .env
# Sửa DATABASE_URL, CORS_ORIGINS trong .env cho môi trường local.
npm run migration:run
npm run start:dev
```

Build và chạy bản compiled:

```bash
npm run build
npm start
```

- `GET /api/v1/health`: liveness public, trả `{ "status": "ok" }`.
- `GET /api/v1/health/ready`: kiểm tra database, trả 503 khi dependency không sẵn sàng.
- `/api/v1/docs`: Swagger UI; `/api/v1/docs-json`: OpenAPI JSON có bearer scheme.

Config được validate khi bootstrap; `DATABASE_URL` bắt buộc, `PORT` mặc định 3000, `DB_POOL_MAX` mặc định 10. `CORS_ORIGINS` là các HTTP origin phân cách dấu phẩy, mặc định không cho phép origin nào. Mỗi request có header `x-request-id`; log chỉ chứa request ID, HTTP method, status và thời gian xử lý, không ghi token/body/query string.

## Các phần đã dựng

- Module Identity, Users, Rooms, Bookings cùng cấu hình, validation, error envelope và response interceptor dùng chung. Identity hiện là ranh giới module chuẩn bị cho Keycloak, chưa có verifier/guard.
- Một DataSource/pool dùng chung, lifecycle shutdown, CLI migration; schema users/rooms/bookings với FK RESTRICT, check và exclusion constraint chống trùng giờ.
- Users đồng bộ hồ sơ qua repository port; Rooms công khai factory cung cấp thao tác khóa phòng cho transaction của Bookings.
- Core service tạo booking và deactivate phòng dùng cùng quy tắc khóa; unit of work tạo repository theo manager của từng transaction và ánh xạ đúng lỗi constraint.

Ranh giới module và nguồn chuẩn từng chủ đề được quản lý ở [architecture](docs/architecture.md). Core services hiện được gọi nội bộ, chưa có controller HTTP nghiệp vụ. Các endpoint trong requirements vẫn là contract cần hoàn thành sau khi có JWT/RBAC; danh sách, hủy booking, CRUD phòng đầy đủ, rate limiting và seeder CLI thuộc các bước tiếp theo.

Handler trả một đối tượng nghiệp vụ để interceptor tạo `{ data: object }`. Handler danh sách phân trang trả `PaginatedResponse<T>` từ `src/common/types/paginated-response.ts`, ví dụ `new PaginatedResponse(rows, { page, limit, total })`, để response có đúng `{ data: rows, meta: { page, limit, total } }`. Health dùng `RawResponse`; HTTP 204 giữ body rỗng.

## Kiểm tra

```bash
npm run typecheck
npm run build
npm test
# Dùng database riêng cho integration test; test tự tạo và xóa schema riêng.
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/booking_test npm run test:integration
```

Unit/HTTP tests kiểm tra DI, envelope/validation, CORS, health, Swagger, quy tắc lấy userId từ principal đã đồng bộ và ánh xạ lỗi. Owner policy xem/hủy booking qua HTTP chưa có vì các API đó chưa được triển khai. Integration tests chạy PostgreSQL thật để kiểm tra migration, concurrency, lịch liền nhau, cancelled, rollback và thứ tự khóa giữa booking/deactivate. Test yêu cầu database riêng với quyền tạo schema/extension. Không thay PostgreSQL bằng SQLite vì exclusion constraint và khóa dòng là hành vi cần kiểm chứng.
