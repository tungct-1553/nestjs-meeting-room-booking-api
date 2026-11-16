# Database

Một PostgreSQL container lưu dữ liệu ứng dụng và Keycloak trong cùng database `meeting_room_booking`. Schema `public` thuộc phạm vi ứng dụng; schema `keycloak` lưu bảng nội bộ Keycloak. Hai service dùng database role `booking_user` và `keycloak_user` riêng, không có quyền chéo schema. [ERD](database.drawio) mô tả entity và quan hệ; migration SQL trong `src/database/migrations` định nghĩa schema.

## Schema

| Bảng | Trường | Ràng buộc |
|---|---|---|
| `users` | `id` UUID, `keycloak_sub` text, `email`/`display_name` text nullable, timestamps | PK `id`; UNIQUE `keycloak_sub` |
| `rooms` | `id` UUID, `name` text, `capacity` integer, `description` text nullable, `is_active` boolean, timestamps | PK `id`; UNIQUE `name`; CHECK `capacity > 0` |
| `bookings` | `id` UUID, `room_id`/`user_id` UUID, `title` text, `start_at`/`end_at` timestamptz, `status` text, timestamps | PK `id`; FK `RESTRICT`; CHECK `start_at < end_at`; status `confirmed`/`cancelled`; exclusion constraint |

UUID mặc định là `gen_random_uuid()`. `created_at` và `updated_at` mặc định `now()`; TypeORM cập nhật `updated_at` khi adapter thực hiện update. Database không có trigger cập nhật timestamp.

`keycloak_sub` định danh hồ sơ theo Keycloak; email/display name là snapshot nullable. Tên phòng dùng UNIQUE phân biệt chữ hoa/thường. Thời gian booking dùng `timestamptz`, response serialize ISO 8601 UTC.

## Constraint và index

- Bootstrap quản trị cài `btree_gist` trong `public`; migration ứng dụng giữ `CREATE EXTENSION IF NOT EXISTS` để hỗ trợ môi trường test độc lập.
- Constraint `bookings_no_overlap`: `room_id WITH =` và `tstzrange(start_at, end_at, '[)') WITH &&`, áp dụng khi `status = 'confirmed'`.
- Booking liền nhau không trùng lịch; booking cancelled không giữ khoảng thời gian.
- Index `bookings_user_created_id` trên `(user_id, created_at, id)` phục vụ danh sách cá nhân.
- Không thêm index search riêng cho phòng; UNIQUE `rooms(name)` đã có index. Index bổ sung cần kết quả đo query và migration riêng.

## Migration

Migration SQL được viết tay. Cấu hình TypeORM giữ `synchronize: false`, `migrationsRun: false` và `installExtensions: false`. Chạy migration bằng CLI trước khi khởi động ứng dụng.

Metadata entity phục vụ truy vấn, chưa mô tả đầy đủ FK, exclusion constraint và UUID defaults. Không sử dụng `migration:generate` khi metadata chưa đồng bộ với schema. Thay đổi migration phải được kiểm tra FK, CHECK, exclusion constraint, index và defaults bằng PostgreSQL integration tests.

Revert xóa bảng và constraint theo thứ tự bookings → rooms → users; giữ extension `btree_gist` vì có thể được dùng chung.

## Kết nối

`DatabaseModule` khởi tạo một DataSource/pool cho tiến trình HTTP. `DatabaseLifecycle` đóng pool qua shutdown hook. File `src/database/data-source.ts` export DataSource cho TypeORM CLI; CLI quản lý initialize/destroy trong tiến trình riêng.

Repository trong transaction sử dụng `EntityManager` của callback, không dùng manager mặc định hoặc tạo pool riêng. Quy tắc khóa phòng và phạm vi transaction được mô tả tại [architecture.md](architecture.md).

## Bootstrap local

`infra/postgres/bootstrap.sql` thu hồi quyền schema từ `PUBLIC`, đặt `search_path` ứng dụng là `public` và Keycloak là `keycloak`, cấp quyền tạo object cho đúng role. Hai role không có superuser, quyền tạo database/role, membership vào role khác hoặc ownership database. Bootstrap từ chối database do một trong hai service role sở hữu; việc chuyển database owner sang quản trị viên phải thực hiện riêng trước bootstrap. Schema `public` không được thuộc `keycloak_user`; schema `keycloak` phải thuộc `keycloak_user`.

Volume mới chạy script init tự động. Volume đã có dữ liệu dùng `scripts/bootstrap-database.sh`; script dừng nếu bảng ứng dụng có owner khác. Tùy chọn `--adopt-app-objects` chuyển ownership riêng bảng `users`, `rooms`, `bookings`, `migrations` và sequence liên quan. Không chuyển ownership object Keycloak/extension hoặc xóa dữ liệu. Script có thể chạy lại; migration/revert ứng dụng chỉ quản lý schema `public`.
