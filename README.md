# Meeting Room Booking API - Nestjs Tutorial

REST API đặt phòng họp sử dụng NestJS, TypeORM, PostgreSQL và Keycloak. Kiến trúc modular monolith, tách API Client/Admin và dùng chung tầng nghiệp vụ.

## Yêu cầu

- Node.js 22.13+, npm.
- Docker Compose.

## Chạy local

```bash
npm ci
cp .env.example .env
```

Cấu hình `.env` theo [mẫu](.env.example). `DATABASE_URL` phải khớp `BOOKING_DB_PASSWORD` và `POSTGRES_PORT`; password trong URL cần URL-encode. Với volume có sẵn, chạy `bash scripts/bootstrap-database.sh` sau khi PostgreSQL sẵn sàng và trước khi khởi động Keycloak; xem [bootstrap database](docs/database.md#bootstrap-local).

```bash
docker compose up -d --wait
npm run migration:run
node scripts/bootstrap-keycloak-users.mjs
npm run start:dev
```

PostgreSQL dùng schema `public` cho ứng dụng và `keycloak` cho Keycloak.

| Dịch vụ | URL |
|---|---|
| Client Swagger | http://localhost:3000/api/v1/docs/client |
| Admin Swagger | http://localhost:3000/api/v1/docs/admin |
| Keycloak Admin Console | http://localhost:8081/admin |

Swagger hỗ trợ OAuth2 Authorization Code + PKCE và bearer token. Redirect URI mặc định dùng `http://localhost:3000`; đổi host/cổng API cần cập nhật redirect URI và Web Origins trong Keycloak.

| Tài khoản test | Password trong `.env` |
|---|---|
| `employee@example.test` | `KEYCLOAK_EMPLOYEE_PASSWORD` |
| `admin@example.test` | `KEYCLOAK_TEST_ADMIN_PASSWORD` |

Sau đăng nhập Employee, gọi `POST /api/v1/client/users/sync` không có body trước khi đọc `/client/users/me`. Script bootstrap cấp sẵn hồ sơ Admin; `/admin/users/me` chỉ đọc. Xem [luồng khởi tạo hồ sơ](docs/user-provisioning.md).

## Build và test

```bash
npm run build
npm start
```

Build xóa `dist` trước khi biên dịch để không giữ module cũ khi thay đổi cấu trúc folder.

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
node scripts/test-bootstrap.mjs
TEST_DATABASE_URL='<PostgreSQL test URL>' npm run test:integration
TEST_DATABASE_URL='<PostgreSQL test URL>' npm run test:e2e
```

Integration và E2E yêu cầu PostgreSQL 17+ UTF-8, database test riêng với quyền tạo schema/extension. Test bootstrap tự tạo và xóa PostgreSQL container tạm.

E2E chạy luồng đặt/hủy phòng qua HTTP với PostgreSQL thật, JWT ký bằng test key và JWKS local; không cần chạy Keycloak. Mỗi suite tạo schema riêng và xóa khi kết thúc. Xem [phạm vi E2E](docs/plans/booking-flow-e2e.md).

`npm run test:architecture` kiểm tra riêng ranh giới layer và module. Dùng `npm run format` để định dạng code và `npm run lint:fix` để sửa các lỗi lint tự động.

## Tài liệu

- [API contract](docs/requirements.md)
- [User provisioning](docs/user-provisioning.md)
- [Kiến trúc](docs/architecture.md)
- [Quy tắc coding](docs/coding-standards.md)
- [Database](docs/database.md) · [ERD](docs/database.drawio)
- [DI và transaction](docs/implementation-patterns.md)
- [Overview khóa học](docs/overview.md)
