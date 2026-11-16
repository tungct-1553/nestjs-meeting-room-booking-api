# Meeting Room Booking API

NestJS modular monolith cho đặt phòng họp, sử dụng PostgreSQL và Keycloak. API Client/Admin có controller và DTO riêng, dùng chung application service và repository.

## Local

Yêu cầu Node.js 22+, Docker Compose và npm.

```bash
npm ci
cp .env.example .env
# Thay các password; DATABASE_URL phải khớp BOOKING_DB_PASSWORD và POSTGRES_PORT.
docker compose up -d --wait
npm run migration:run
node scripts/bootstrap-keycloak-users.mjs
npm run start:dev
```

PostgreSQL dùng database `meeting_room_booking`, schema `public` cho ứng dụng và schema `keycloak` cho Keycloak. Mỗi schema có database role riêng. PostgreSQL mặc định cổng 5432; đổi `POSTGRES_PORT` nếu cổng đã được sử dụng. Keycloak ở `http://localhost:8081`, API ở `http://localhost:3000`.

| Biến môi trường | Giá trị/ý nghĩa |
|---|---|
| `DATABASE_URL` | URL kết nối bằng `booking_user` |
| `POSTGRES_PASSWORD` | Password quản trị PostgreSQL dùng bootstrap |
| `BOOKING_DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD` | Password hai database role |
| `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD` | Quản trị Keycloak, mặc định username `admin` |
| `KEYCLOAK_EMPLOYEE_PASSWORD`, `KEYCLOAK_TEST_ADMIN_PASSWORD` | Password tài khoản local test |
| `KEYCLOAK_ISSUER` | `http://localhost:8081/realms/meeting-room` |
| `API_CLIENT_ID` | `meeting-room-api` |
| `PORT`, `DB_POOL_MAX` | Mặc định 3000 và 10 |
| `CORS_ORIGINS` | Danh sách HTTP origin phân cách dấu phẩy |

Không đưa `.env` vào Git. URL phải URL-encode ký tự đặc biệt trong password.

## Bootstrap database

Script init chạy trên volume mới. Với volume có sẵn, khởi động PostgreSQL rồi áp dụng bootstrap trước khi khởi động Keycloak:

```bash
docker compose up -d postgres
bash scripts/bootstrap-database.sh
docker compose up -d --wait keycloak
```

Bootstrap tạo role/schema/extension và cấp quyền theo schema; chạy lại không xóa dữ liệu. Database phải thuộc tài khoản quản trị, không thuộc `booking_user` hoặc `keycloak_user`; script dừng nếu owner không phù hợp và không tự đổi database owner. Nếu bảng ứng dụng có owner khác, script dừng. Sau khi kiểm tra ownership, dùng `bash scripts/bootstrap-database.sh --adopt-app-objects` để chuyển riêng các bảng ứng dụng và sequence liên quan sang `booking_user`. Schema `public` do `keycloak_user` sở hữu, schema Keycloak có owner khác hoặc hai service role có membership ngoài dự kiến phải được xử lý riêng bằng tài khoản quản trị.

`docker compose down` giữ volume. `docker compose down -v` xóa toàn bộ dữ liệu local, gồm tài khoản và cấu hình Keycloak.

Bootstrap từ chối default privileges cấp quyền table/sequence cho `PUBLIC` hoặc service đối diện, cả global và theo schema của service. Quản trị viên phải thu hồi đúng default grant trước khi chạy lại; `IN SCHEMA REVOKE` không thu hồi được global grant. Script không tự thay đổi default privileges.

## Keycloak và đăng nhập

Realm `meeting-room` được import khi chưa tồn tại. Import không ghi đè realm đã có; thay đổi cấu hình realm hiện có qua Admin Console tại `http://localhost:8081/admin`. Hai client public dùng Authorization Code + PKCE S256; Direct Access Grants bị tắt. API audience là `meeting-room-api`; role lấy từ client roles `employee`/`admin`. Tài khoản đăng ký mặc định có Employee; Admin do quản trị viên cấp.

| Swagger UI | OAuth client | Callback |
|---|---|---|
| `/api/v1/docs/client` | `meeting-room-client` | `/api/v1/docs/client/oauth2-redirect.html` |
| `/api/v1/docs/admin` | `meeting-room-admin` | `/api/v1/docs/admin/oauth2-redirect.html` |

Callback được đăng ký với origin `http://localhost:3000`. Khi đổi host/cổng API, cập nhật redirect URI và Web Origins tương ứng trong Keycloak. Trang `/api/v1/docs` liên kết tới hai UI. Mỗi UI có Authorize để đăng nhập bằng PKCE hoặc nhập bearer token trực tiếp.

Script bootstrap tạo/cập nhật `employee@example.test` và `admin@example.test`, đọc password từ môi trường. Chạy lại giữ UUID tài khoản và cập nhật password/profile local. Access token có TTL 5 phút; session idle 30 phút. Refresh token được xử lý ở Keycloak bằng refresh-token grant với đúng OAuth client, API không cung cấp login/register/refresh endpoint riêng.

## API

| Endpoint | Quyền |
|---|---|
| `GET /api/v1/health` | Public |
| `GET /api/v1/health/ready` | Public; 503 khi PostgreSQL không sẵn sàng |
| `GET /api/v1/client/users/me` | Employee/Admin |
| `GET /api/v1/admin/users/me` | Admin |

Hồ sơ trả `{ data: { id, email, displayName } }`; UUID ứng dụng được đồng bộ từ Keycloak `sub`. Token sai trả 401, thiếu role trả 403; lỗi lấy JWKS khi không có key cache khả dụng trả 503. Lỗi giữ envelope `{ error: { code, message, details } }`.

JWT verifier dùng RS256, issuer/audience/type và thời gian hiệu lực. JWKS cache tối đa 5 key trong 10 phút, timeout 5 giây, giới hạn 10 request/phút mỗi tiến trình. HTTP logging chỉ ghi request ID, method, status và duration.

HTTP Rooms/Bookings, rate limiting và seeder nghiệp vụ chưa được triển khai. Core transaction booking/deactivate và migration đã có.

## Kiểm tra

```bash
npm run typecheck
npm run build
npm test
node scripts/test-bootstrap.mjs
TEST_DATABASE_URL=postgresql://test_user:password@localhost:5432/booking_test npm run test:integration
```

Integration tests dùng database test riêng, tạo/xóa schema riêng. Các kiểm thử schema bootstrap cần credentials quản trị; tài khoản runtime không có quyền tạo schema khác. Build chạy bằng `npm run build && npm start`.

`test-bootstrap.mjs` yêu cầu Docker, tự tạo/xóa container PostgreSQL tạm và không dùng database local. Test kiểm tra default grants cũ, bootstrap preflight và quyền sequence mới qua numeric OID.

## Tài liệu

- [Requirements và API contract](docs/requirements.md)
- [Kiến trúc](docs/architecture.md)
- [DI và transaction](docs/implementation-patterns.md)
- [Database](docs/database.md) · [ERD](docs/database.drawio)
- [Overview khóa học](docs/overview.md)
