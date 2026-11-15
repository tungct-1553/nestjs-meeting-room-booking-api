# Database design

**Trạng thái:** đã có entity TypeORM và migration ban đầu trong `src/database/migrations`; thiết kế này là cơ sở triển khai. Mở [database.drawio](database.drawio) bằng draw.io để chỉnh sửa. ERD tóm tắt entity/quan hệ; migration SQL chứa đầy đủ constraint/default và quyết định schema thực tế.

## Entities

| Bảng | Trường chính | Quan hệ và ràng buộc |
|---|---|---|
| `users` | `id` UUID PK, `keycloak_sub` text UNIQUE, `email` text nullable, `display_name` text nullable, timestamps | Một user có nhiều booking; không lưu password hay role nguồn của Keycloak |
| `rooms` | `id` UUID PK, `name` text UNIQUE, `capacity` integer, `description` text nullable, `is_active` boolean, timestamps | `capacity > 0`; ngừng hoạt động thay cho xóa cứng |
| `bookings` | `id` UUID PK, `room_id` UUID FK, `user_id` UUID FK, `title` text, `start_at`/`end_at` timestamptz, `status`, timestamps | FK `RESTRICT`; status `confirmed`/`cancelled`; `start_at < end_at`; exclusion constraint cho booking confirmed |

Migration đặt default UUID `gen_random_uuid()` và default `created_at`/`updated_at` là `now()`. TypeORM cập nhật `updated_at` trong các thao tác update của adapter; không có trigger tự cập nhật timestamp khi chạy SQL ngoài ứng dụng. Đồng bộ user theo `keycloak_sub` đã xác thực; email và display name chỉ là snapshot có thể thay đổi. Tên phòng sử dụng ràng buộc UNIQUE của PostgreSQL; so sánh phân biệt chữ hoa/thường.

## Chống trùng lịch và index

Migration SQL viết tay trong `src/database/migrations` là nguồn sự thật của schema; `synchronize` luôn giữ `false`. Metadata entity hiện phục vụ truy vấn và chưa phản ánh đầy đủ FK, exclusion constraint và UUID defaults của migration. Chưa hỗ trợ `migration:generate` cho đến khi metadata được đối chiếu đầy đủ; không thêm import entity xuyên feature chỉ để khai báo relation. Mỗi thay đổi migration phải được review các FK `RESTRICT`, check, exclusion constraint, index và UUID defaults, rồi kiểm chứng bằng PostgreSQL integration tests.

Migration tạo extension `btree_gist` trong schema `public`; runtime dùng `installExtensions: false` và không tự cài extension. Lệnh revert giữ extension vì extension có thể được dùng chung. Constraint/index còn lại được tạo và xóa theo migration; exclusion constraint GiST theo `room_id WITH =` và `tstzrange(start_at, end_at, '[)') WITH &&`, điều kiện `status = 'confirmed'`. Đây là bảo vệ cho các giao dịch đồng thời; booking cancelled không nằm trong constraint. Giá trị thời gian lưu UTC bằng `timestamptz`.

Index bổ sung: `bookings(user_id, created_at, id)` cho danh sách cá nhân; v1 không thêm index tên phòng/search ngoài UNIQUE `rooms(name)` hiện có. Chỉ thêm index mới bằng migration riêng khi có kết quả đo truy vấn chứng minh cần thiết. Không thêm index trùng với PK/UNIQUE đã tồn tại.

## Transaction và quản lý kết nối

Ứng dụng dùng TypeORM với một `DataSource`/connection pool được đăng ký tập trung trong `DatabaseModule`. Adapter unit of work nhận `DataSource` qua DI; các repository trong transaction được tạo với `EntityManager` của callback, không dùng repository singleton với manager mặc định. Không tạo pool riêng. Lifecycle provider đóng `DataSource` khi NestJS shutdown; migrations được quản lý trong tầng database/infrastructure.

Use case tạo booking được điều phối bởi `BookingsService` qua `BookingUnitOfWork`. Adapter TypeORM mở transaction bằng `DataSource.transaction(...)` và gắn các repository tham gia use case vào `EntityManager` của transaction đó. Application service không nhận hoặc truyền `EntityManager` trực tiếp; module Rooms không tự mở transaction độc lập trong luồng tạo booking.

Trong transaction, truy vấn phòng theo ID với khóa pessimistic write (`SELECT ... FOR UPDATE`), xác nhận phòng còn active rồi ghi booking bằng cùng transaction manager. Thao tác admin ngừng hoạt động phòng khóa cùng dòng trước khi cập nhật `is_active = false`. Cách này ngăn deactivate chen giữa kiểm tra trạng thái và insert booking; exclusion constraint vẫn độc lập bảo vệ chống trùng lịch đồng thời. Migration đặt tên constraint là `bookings_no_overlap`; chỉ lỗi `23P01` của constraint này được chuyển thành lỗi booking trùng giờ rồi ánh xạ thành HTTP 409.

```text
DataSource pool (một lần khi app khởi động)
  └── BookingUnitOfWork.run(callback)
       ├── lock room row + check is_active
       └── insert booking (cùng EntityManager/transaction)
```

Port `BookingUnitOfWork` nằm trong Bookings; `DatabaseModule` chỉ quản lý kết nối và migration. Infrastructure của Bookings dùng `RoomsTransactionFactory` công khai để nhận thao tác khóa phòng cùng manager; không import entity/repository nội bộ của Rooms.

Thiết kế dùng isolation `READ COMMITTED` và khóa dòng phòng cho cả tạo booking/deactivate. User upsert trước transaction booking, nên profile vẫn được giữ khi booking thất bại.

Chi tiết ranh giới module tại [architecture.md](architecture.md); ví dụ DI, lifecycle và transaction tại [implementation-patterns.md](implementation-patterns.md).

## Tự kiểm tra

- [x] Kiểm tra mapping với requirement, role, quan hệ và concurrency.
- [x] Đã chạy migration trên PostgreSQL 17 và integration test cho concurrency, lịch liền nhau/cancelled, rollback, deactivate và user upsert.
- [ ] Kiểm thử bổ sung trực tiếp các CHECK/FK và hiệu quả index khi triển khai các query CRUD/list.
- [x] Làm rõ trách nhiệm connection pool, transaction và khóa dòng phòng trong thiết kế.
