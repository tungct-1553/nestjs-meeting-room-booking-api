# Database

PostgreSQL lưu dữ liệu ứng dụng và Keycloak trong database `meeting_room_booking`. [ERD](database.drawio) thể hiện quan hệ dữ liệu; [migrations](../src/database/migrations/) định nghĩa bảng, defaults và constraints của ứng dụng.

## Phân vùng dữ liệu

| Schema | Chủ thể sử dụng | Database role | Quản lý schema |
|---|---|---|---|
| `public` | NestJS API | `booking_user` | Migration TypeORM |
| `keycloak` | Keycloak | `keycloak_user` | Migration nội bộ Keycloak |

Hai service dùng chung PostgreSQL container nhưng không đọc hoặc ghi schema của nhau. API lấy danh tính qua access token, không truy vấn bảng Keycloak. Runtime và CLI migration ứng dụng dùng cùng cấu hình `DATABASE_URL`; trong cấu hình local, cả hai sử dụng `booking_user`.

`search_path` của `booking_user` là `public`; của `keycloak_user` là `keycloak`. Migration ứng dụng dùng tên bảng không qualified, nên chạy bằng đúng role/database là điều kiện để tạo bảng trong schema ứng dụng. Keycloak đồng thời được cấu hình `KC_DB_SCHEMA=keycloak`.

## Mô hình ứng dụng

| Bảng | Dữ liệu | Ràng buộc |
|---|---|---|
| `users` | `id` UUID, `keycloak_sub` text; `email`, `display_name` text nullable; `profile_token_iat` double precision nullable; timestamps | PK `id`, UNIQUE `keycloak_sub` |
| `rooms` | `id` UUID, `name` text, `capacity` integer, `description` text nullable, `is_active` boolean; timestamps | PK `id`, unique expression index cho danh tính tên, CHECK `capacity > 0` |
| `bookings` | `id` UUID, `room_id`, `user_id` UUID, `title` text, `start_at`, `end_at` timestamptz, `status` text; timestamps | PK `id`, FK tới Rooms/Users, CHECK thời gian và status, exclusion constraint |

Một user và một phòng có nhiều booking. `bookings.user_id` tham chiếu UUID ứng dụng; `keycloak_sub` là khóa đồng bộ danh tính, không phải khóa ngoại booking. Email/display name được cập nhật từ token qua endpoint sync như profile snapshot, không quyết định quyền truy cập; role không được lưu trong bảng `users`.

`profile_token_iat` lưu NumericDate từ token đã sync. Kiểu `double precision` khớp số JavaScript và giữ phần giây lẻ; sync chấp nhận số hữu hạn từ 0 đến `Number.MAX_SAFE_INTEGER`. Watermark null dành cho hồ sơ cũ hoặc Admin được cấp qua CLI. Migration `UserProfileTokenIat` chỉ thêm cột nullable, giữ UUID và FK; lần sync đầu tiên đặt watermark. Token cùng/cũ hơn không đổi snapshot hoặc `updated_at`.

Hai FK dùng `ON DELETE RESTRICT`, giữ lịch sử booking khi dữ liệu liên quan còn được tham chiếu. Deactivate đặt `rooms.is_active = false`; cancel đặt `bookings.status = 'cancelled'`, không xóa dòng booking.

### Defaults và thời gian

- UUID mặc định `gen_random_uuid()`; `created_at`/`updated_at` mặc định `now()`.
- TypeORM cập nhật `updated_at` khi adapter thực hiện update. SQL chạy ngoài adapter không được trigger tự động cập nhật timestamp.
- `is_active` mặc định `true`; status booking mặc định `confirmed`, chỉ nhận `confirmed` hoặc `cancelled`.
- `start_at`/`end_at` dùng `timestamptz` để biểu diễn thời điểm tuyệt đối. PostgreSQL không giữ timezone gốc của input; cách hiển thị phụ thuộc timezone của session. HTTP serialize thành ISO 8601 UTC, còn input phải có timezone theo [API contract](requirements.md).
- Tên phòng được lưu sau trim và chuẩn hóa NFC, giữ hoa/thường để hiển thị. Unique expression index `rooms_name_key` so sánh theo trim/NFC và lowercase với collation `pg_c_utf8`; không phân biệt hoa/thường nhưng vẫn phân biệt dấu.

### Danh tính tên phòng

PostgreSQL 17 với encoding UTF8 cung cấp `normalize` và collation `pg_c_utf8`. Collation này dùng Unicode simple-case mapping cho `lower`, giúp identity không phụ thuộc locale mặc định của hệ điều hành. Database index áp dụng cùng tập ký tự trim của ECMAScript, gồm cả NBSP/BOM; không chỉ dùng `btrim(name)` mặc định loại dấu cách ASCII. Tham khảo [string functions](https://www.postgresql.org/docs/17/functions-string.html) và [collation](https://www.postgresql.org/docs/17/collation.html).

Index tính identity từ tên, không thêm cột name-key và không đổi tên hiển thị thành chữ thường. [Unique expression index](https://www.postgresql.org/docs/17/indexes-expressional.html) bảo vệ cả thao tác ghi ngoài application và request đồng thời. Duplicate violation vẫn mang tên `rooms_name_key` để adapter map sang `ROOM_NAME_CONFLICT`.

Migration mới khóa bảng và kiểm tra dữ liệu cũ trước khi backfill trim/NFC, thay simple UNIQUE bằng expression index trong cùng transaction. Tên cũ trùng identity hoặc không đạt quy tắc độ dài làm migration dừng; không tự gộp/xóa/đổi tên để tránh mất liên kết booking. Khi thành công, UUID, trạng thái, FK và timestamps được giữ nguyên. Down migration khôi phục simple UNIQUE, giữ tên đã được chuẩn hóa.

## Ràng buộc lịch và index

`CHECK (start_at < end_at)` loại khoảng thời gian không hợp lệ. Constraint `bookings_no_overlap` ngăn hai booking confirmed cùng phòng giao nhau:

```sql
EXCLUDE USING gist (
  room_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status = 'confirmed')
```

Extension `btree_gist` cung cấp operator class để kết hợp so sánh UUID phòng và overlap của khoảng thời gian trong GiST. Với một booking confirmed từ `10:00Z` đến `11:00Z`:

| Booking mới cùng phòng | Kết quả constraint |
|---|---|
| `10:30Z`–`11:30Z`, confirmed | Từ chối do overlap |
| `11:00Z`–`12:00Z`, confirmed | Cho phép vì khoảng `[start, end)` không chứa điểm kết thúc |
| `10:30Z`–`11:30Z`, cancelled | Không tham gia constraint |

Constraint bảo vệ dữ liệu khi có ghi đồng thời hoặc ghi ngoài application service. Khóa dòng phòng trong [luồng transaction](architecture.md#4-transaction-và-tính-nhất-quán) bảo vệ trạng thái active; nó không thay thế constraint lịch.

Index `bookings_user_created_id` trên `(user_id, created_at, id)` phục vụ lọc booking theo owner và thứ tự danh sách ổn định. PK, UNIQUE và exclusion constraint đã tạo index tương ứng; không tạo lại index trùng. Phòng chưa có index search riêng; index bổ sung được quyết định từ query plan và thêm bằng migration riêng.

## Migration và kết nối

Migration SQL viết tay quản lý schema; metadata entity phục vụ truy vấn. Entity chưa mô tả đầy đủ FK, exclusion constraint và UUID defaults, nên không dùng `migration:generate` khi metadata chưa khớp schema.

| Cấu hình TypeORM | Giá trị | Ý nghĩa |
|---|---|---|
| `synchronize` | `false` | Không sửa schema từ entity khi khởi động |
| `migrationsRun` | `false` | Chạy migration bằng CLI trước khi khởi động API |
| `installExtensions` | `false` | Bootstrap quản trị chịu trách nhiệm cài extension |

Bootstrap cài `btree_gist` vào `public`; migration giữ `CREATE EXTENSION IF NOT EXISTS` để dùng trong môi trường test độc lập có đủ quyền. Revert migration watermark chỉ xóa `profile_token_iat`; revert migration khởi tạo xóa bookings → rooms → users và các index/constraint liên quan, giữ extension dùng chung. Keycloak quản lý migration trong schema riêng; lệnh migration ứng dụng không quản lý bảng Keycloak.

Tiến trình HTTP dùng một DataSource/pool từ `DatabaseModule`, đóng qua shutdown hook. TypeORM CLI nhận DataSource chưa initialize từ `src/database/data-source.ts` và quản lý vòng đời kết nối trong tiến trình riêng. Quy tắc sử dụng manager trong transaction nằm tại [architecture.md](architecture.md#4-transaction-và-tính-nhất-quán); lệnh chạy nằm trong [README](../README.md).

## Bootstrap local

[Bootstrap SQL](../infra/postgres/bootstrap.sql) chạy bằng tài khoản quản trị. Script init áp dụng trên volume mới; volume có sẵn chạy `scripts/bootstrap-database.sh` trước khi khởi động Keycloak.

Preflight chạy trước mọi thay đổi role, ACL và ownership:

| Điều kiện bị từ chối | Lý do |
|---|---|
| Một service role sở hữu database; `keycloak_user` sở hữu `public`; schema Keycloak có owner khác | Ownership cho phép quản lý object hoặc cấp lại quyền, không bị loại bỏ bằng `REVOKE` |
| Service role có membership trong role khác | Quyền có thể đến từ role ngoài phạm vi bootstrap |
| Bảng ứng dụng/sequence liên quan có owner khác | Việc tiếp quản object phải được chỉ định rõ bằng `--adopt-app-objects` |
| Default grants table/sequence tới `PUBLIC` hoặc service đối diện | Object được tạo sau bootstrap có thể được cấp lại quyền chéo service |

Sau preflight, script tạo/cập nhật hai login role, bỏ quyền quản trị, đặt `search_path`, cấp quyền đúng schema và thu hồi quyền object chéo service. Các thao tác chạy trong một transaction; lỗi làm rollback. Chạy lại không xóa dữ liệu.

`--adopt-app-objects` chỉ chuyển ownership các bảng `users`, `rooms`, `bookings`, `migrations` và sequence thuộc các bảng đó. Tùy chọn không bỏ qua kiểm tra database owner, schema owner, membership hoặc default privileges; không tiếp quản object Keycloak/extension.

### Object ACL và default ACL

Thu hồi ACL trên object hiện có không thay đổi quyền mặc định của object tương lai. Bootstrap kiểm tra `pg_default_acl` theo creator role ở cả mức global và schema tương ứng. Service role đối diện hoặc `PUBLIC` có default grant sẽ làm script dừng; quản trị viên phải thu hồi đúng grant rồi chạy lại.

Ví dụ thu hồi default grant sequence của `booking_user` cho `keycloak_user`, tùy cấp đã cấp quyền:

```sql
-- Global default grant
ALTER DEFAULT PRIVILEGES FOR ROLE booking_user
REVOKE USAGE ON SEQUENCES FROM keycloak_user;

-- Default grant riêng schema public
ALTER DEFAULT PRIVILEGES FOR ROLE booking_user IN SCHEMA public
REVOKE USAGE ON SEQUENCES FROM keycloak_user;
```

`IN SCHEMA REVOKE` không thu hồi global default grant. Với sequence, quyền object cũng phải được thu hồi: thao tác qua numeric OID có thể bỏ qua bước tra cứu tên trong schema. Bootstrap xử lý ACL bảng và sequence liên quan của ứng dụng, cùng bảng/sequence trong schema Keycloak; default privileges ở schema ngoài phạm vi được giữ nguyên.
