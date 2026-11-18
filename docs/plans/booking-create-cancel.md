# Booking create/cancel

| API | Quyền | Kết quả |
|---|---|---|
| `POST /api/v1/client/bookings` | Employee/Admin | 201 `{ data: Booking }` |
| `DELETE /api/v1/client/bookings/:id` | Employee/Admin và owner | 200 `{ data: Booking }` với status `cancelled` |

POST nhận `roomId`, `title`, `startAt`, `endAt`; từ chối field khác. Title được trim, dài 1–200 Unicode code point và không chứa NUL. Timestamp phải là ISO 8601 có timezone, được chuyển sang `Date` tại controller và phản hồi ISO UTC với độ chính xác millisecond. Cả hai API lookup hồ sơ theo `sub` đã xác minh qua `UsersQueryApi`; chưa có hồ sơ trả 409. Client không truyền `userId`.

## Phân lớp và transaction

- Controller nhận DTO/principal, map input thuần và response DTO. DTO/Pipe kiểm tra UUID, title và timestamp; guard kiểm tra JWT/role.
- [BookingsService.create](../../src/bookings/application/bookings.service.ts) trim/validate title, lookup UUID user, mở UoW, khóa phòng, kiểm tra active và thời gian sau khi chờ khóa rồi insert `confirmed`. Giữ `READ COMMITTED`, cùng transaction manager với Rooms và exclusion constraint hiện có.
- `BookingsService.cancel` lookup user, mở UoW, khóa booking bằng `FOR UPDATE`. Application kiểm tra tồn tại và owner trước nhánh idempotent; Admin cũng chịu kiểm tra owner. Cho phép hủy khi phòng đã inactive hoặc lịch đã bắt đầu/kết thúc.
- Cancellation chỉ khóa booking; không lấy khóa phòng, nên không tạo chu trình khóa với create/deactivate. Exclusion constraint đồng bộ create đang chờ với cancellation chưa commit. Một create cạnh tranh có thể trả conflict nếu cancel chưa giải phóng lịch; gọi create sau cancel thành công phải đặt lại được.
- [Repository](../../src/bookings/infrastructure/typeorm-booking.repository.ts) nhận manager đang trong transaction, trả model thuần/null và cập nhật status theo application. Không quyết định owner, not-found hoặc status nghiệp vụ. Không xóa booking hoặc thay room/user/title/thời gian.

Sau khi lookup `user` từ `input.actorSub`, cancellation giữ quyết định nghiệp vụ trong application:

```ts
return this.uow.run(async ({ bookings }) => {
  const booking = await bookings.lockById(input.bookingId);
  if (booking === null) {
    throw new BookingNotFoundError();
  }
  if (booking.userId !== user.id) {
    throw new BookingOwnerRequiredError();
  }
  if (booking.status === 'cancelled') {
    return booking;
  }
  return bookings.updateStatus(booking.id, 'cancelled');
});
```

`updateStatus` UPDATE rồi đọc model bằng cùng manager. Nhánh đã cancelled trả model hiện có mà không ghi.

Thiếu/sai token trả 401; thiếu role/khác owner trả 403; UUID/payload/title/thời gian sai trả 400; booking không tồn tại/phòng không khả dụng trả 404; lịch trùng trả 409. [UoW adapter](../../src/bookings/infrastructure/typeorm-booking-unit-of-work.ts) chỉ map SQLSTATE `23P01` của constraint `bookings_no_overlap` sang `BOOKING_TIME_CONFLICT` bên ngoài transaction; lỗi khác giữ nguyên để filter trả lỗi an toàn.

## Kiểm chứng

- Unit controller/service: mapping và response whitelist; title/time invariant, owner, missing, cancelled, thứ tự khóa và propagation lỗi.
- HTTP qua Nest pipeline: JWT/RBAC, unknown field, UUID, title biên/NUL, timezone/time, status/envelope và Client/Admin Swagger.
- PostgreSQL: tạo đồng thời/trùng lịch, khoảng giờ liền nhau, cancel lặp/đồng thời, cancel giải phóng lịch, owner failure/rollback, bảo toàn lịch sử, escaped transaction ports, create/deactivate và thời gian hết hạn sau khi chờ khóa.
- Chạy toàn bộ unit/HTTP/architecture và integration tests, lint, format, typecheck, build.

PR độc lập từ `master`; không cần API đọc/deactivate phòng của PR Room. GET booking list/detail nằm ngoài phạm vi.
