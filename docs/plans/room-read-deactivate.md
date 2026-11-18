# Room list/detail/deactivate

| API | Quyền | Contract |
|---|---|---|
| GET `/api/v1/client/rooms` | Employee/Admin | 200 danh sách phòng active, envelope `data` và `meta` |
| GET `/api/v1/client/rooms/:id` | Employee/Admin | 200 phòng active; 404 nếu không tồn tại hoặc inactive |
| DELETE `/api/v1/admin/rooms/:id` | Admin | 204 không body; 404 nếu không tồn tại; phòng inactive vẫn trả 204 |

Query list: `page` nguyên an toàn từ 1, mặc định 1; `limit` 1–100, mặc định 20; `capacity` nguyên 1–2147483647 là sức chứa tối thiểu. Offset phải là số nguyên an toàn. `search` trim/NFC, tối đa 200 Unicode code point, không chứa NUL; chuỗi rỗng bỏ filter. Tìm chuỗi con không phân biệt hoa/thường theo PostgreSQL `pg_c_utf8`, phân biệt dấu; `%`, `_` và `\` là ký tự literal. Thứ tự `name ASC, id ASC`. Tổng bản ghi được tính sau filter, cùng snapshot với trang trả về; trang vượt dữ liệu trả mảng rỗng và giữ total.

Client controller map query/param thành input thuần và model thành response DTO riêng. RoomsService validate input, quyết định lỗi không tìm thấy. Read port trả model thuần; adapter singleton dùng DataSource, parameterized SQL và transaction `REPEATABLE READ` riêng cho list/count để cùng snapshot. Không lấy row lock khi đọc. Detail dùng một SELECT. Public contract phục vụ Bookings không đổi.

DELETE gọi use case deactivate hiện có: UoW `READ COMMITTED`, khóa row trước cập nhật `isActive=false`, giữ booking và lịch sử. Controller chỉ map HTTP 204.

Kiểm thử: unit controller/service; HTTP qua JWT/RBAC, validation, response và Swagger; PostgreSQL kiểm tra active/filter/literal wildcard/NFC, pagination/count, detail và deactivate giữ booking. Chạy lại kiểm thử cạnh tranh booking/deactivate, toàn bộ regression, lint, format, typecheck và build.
