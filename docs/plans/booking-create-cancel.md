# Booking create/cancel

| API | Quyền | Kết quả |
|---|---|---|
| `POST /api/v1/client/bookings` | Employee/Admin | 201 `{ data: Booking }` |
| `DELETE /api/v1/client/bookings/:id` | Employee/Admin và owner | 200 `{ data: Booking }` với status `cancelled` |

POST nhận `roomId`, `title`, `startAt`, `endAt`; từ chối field khác. Title được trim, dài 1–200 Unicode code point và không chứa NUL. Timestamp phải là ISO 8601 có timezone, được chuyển sang `Date` tại controller và phản hồi ISO UTC với độ chính xác millisecond. Owner chỉ lấy từ `sub` đã xác minh qua `UsersQueryApi`; chưa có hồ sơ trả 409.

## Phân lớp và transaction

- Controller nhận DTO/principal, map input thuần và response DTO. DTO/Pipe kiểm tra UUID, title và timestamp; guard kiểm tra JWT/role.
- `BookingsService.create` kiểm tra title, lookup UUID user, mở UoW, khóa phòng, kiểm tra active và thời gian sau khi chờ khóa rồi insert `confirmed`. Giữ `READ COMMITTED`, same-manager integration với Rooms và exclusion constraint hiện có.
- `BookingsService.cancel` lookup user, mở UoW, khóa booking bằng `FOR UPDATE`, quyết định lỗi thiếu booking/khác owner và yêu cầu status `cancelled`. Booking đã hủy được trả nguyên trạng; cho phép hủy khi phòng đã inactive hoặc lịch đã bắt đầu/kết thúc.
- Cancellation chỉ khóa booking; không lấy khóa phòng, nên không tạo chu trình khóa với create/deactivate. Exclusion constraint đồng bộ create đang chờ với cancellation chưa commit. Một create cạnh tranh có thể trả conflict nếu cancel chưa giải phóng lịch; gọi create sau cancel thành công phải đặt lại được.
- Repository nhận manager đang trong transaction, trả model thuần/null và cập nhật status theo application. Không quyết định owner, not-found hoặc status nghiệp vụ. Không xóa booking hoặc thay room/user/title/thời gian.

Thiếu/sai token trả 401; thiếu role/khác owner trả 403; UUID/payload/title/thời gian sai trả 400; booking không tồn tại/phòng không khả dụng trả 404; lịch trùng trả 409. Chỉ SQLSTATE `23P01` của constraint `bookings_no_overlap` được map sang `BOOKING_TIME_CONFLICT`; lỗi khác giữ nguyên để filter trả lỗi an toàn.

## Kiểm chứng

- Unit controller/service: mapping và response whitelist; title/time invariant, owner, missing, cancelled, thứ tự khóa và propagation lỗi.
- HTTP qua Nest pipeline: JWT/RBAC, unknown field, UUID, title biên/NUL, timezone/time, status/envelope và Client/Admin Swagger.
- PostgreSQL: tạo đồng thời/trùng lịch, khoảng giờ liền nhau, cancel lặp/đồng thời, cancel giải phóng lịch, owner failure/rollback, bảo toàn lịch sử, escaped transaction ports, create/deactivate và thời gian hết hạn sau khi chờ khóa.
- Chạy toàn bộ unit/HTTP/architecture và integration tests, lint, format, typecheck, build.

PR độc lập từ `master`; không cần API đọc/deactivate phòng của PR Room. GET booking list/detail nằm ngoài phạm vi.
