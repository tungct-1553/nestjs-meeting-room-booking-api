# Database design

**Trạng thái:** thiết kế làm cơ sở triển khai, chưa tạo migration. Mở [database.drawio](database.drawio) bằng draw.io để chỉnh sửa.

## Entities

| Bảng | Trường chính | Quan hệ và ràng buộc |
|---|---|---|
| `users` | `id` UUID PK, `keycloak_sub` text UNIQUE, `email` text nullable, `display_name` text nullable, timestamps | Một user có nhiều booking; không lưu password hay role nguồn của Keycloak |
| `rooms` | `id` UUID PK, `name` text UNIQUE, `capacity` integer, `description` text nullable, `is_active` boolean, timestamps | `capacity > 0`; ngừng hoạt động thay cho xóa cứng |
| `bookings` | `id` UUID PK, `room_id` UUID FK, `user_id` UUID FK, `title` text, `start_at`/`end_at` timestamptz, `status`, timestamps | FK `RESTRICT`; status `confirmed`/`cancelled`; `start_at < end_at`; exclusion constraint cho booking confirmed |

Trường `id` và timestamps do ứng dụng/database tạo. Đồng bộ user theo `keycloak_sub` đã xác thực; email và display name chỉ là snapshot có thể thay đổi. Tên phòng sử dụng ràng buộc UNIQUE của PostgreSQL; so sánh phân biệt chữ hoa/thường.

## Chống trùng lịch và index

PostgreSQL extension `btree_gist`; exclusion constraint GiST theo `room_id WITH =` và `tstzrange(start_at, end_at, '[)') WITH &&`, điều kiện `status = 'confirmed'`. Đây là bảo vệ cho các giao dịch đồng thời; booking cancelled không nằm trong constraint. Giá trị thời gian lưu UTC bằng `timestamptz`.

Index bổ sung: `bookings(user_id, created_at, id)` cho danh sách cá nhân; index tên phòng/search sẽ chọn sau khi xem query. Không thêm index trùng với PK/UNIQUE đã tồn tại.

## Tự kiểm tra

- [x] Kiểm tra mapping với requirement, role, quan hệ và concurrency.
- [ ] Kiểm tra migrations, index và constraints trong PostgreSQL khi triển khai.
