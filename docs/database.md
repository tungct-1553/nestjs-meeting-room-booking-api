# Database

PostgreSQL lưu users, rooms và bookings. [ERD](database.drawio) mô tả entity và quan hệ; migration SQL trong `src/database/migrations` định nghĩa schema.

## Schema

| Bảng | Trường | Ràng buộc |
|---|---|---|
| `users` | `id` UUID, `keycloak_sub` text, `email`/`display_name` text nullable, timestamps | PK `id`; UNIQUE `keycloak_sub` |
| `rooms` | `id` UUID, `name` text, `capacity` integer, `description` text nullable, `is_active` boolean, timestamps | PK `id`; UNIQUE `name`; CHECK `capacity > 0` |
| `bookings` | `id` UUID, `room_id`/`user_id` UUID, `title` text, `start_at`/`end_at` timestamptz, `status` text, timestamps | PK `id`; FK `RESTRICT`; CHECK `start_at < end_at`; status `confirmed`/`cancelled`; exclusion constraint |

UUID mặc định là `gen_random_uuid()`. `created_at` và `updated_at` mặc định `now()`; TypeORM cập nhật `updated_at` khi adapter thực hiện update. Database không có trigger cập nhật timestamp.

`keycloak_sub` định danh hồ sơ theo Keycloak; email/display name là snapshot nullable. Tên phòng dùng UNIQUE phân biệt chữ hoa/thường. Thời gian booking dùng `timestamptz`, response serialize ISO 8601 UTC.

## Constraint và index

- Extension `btree_gist` được cài trong schema `public` bởi migration.
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
