# Booking list/detail

| API | Quyền | Kết quả |
|---|---|---|
| `GET /api/v1/client/bookings` | Employee/Admin | 200 `{ data: Booking[], meta: { page, limit, total } }` của người gọi |
| `GET /api/v1/client/bookings/:id` | Employee/Admin và owner | 200 `{ data: Booking }` |

List nhận `page`, `limit`, `status`; mặc định `page=1`, `limit=20`. Limit hợp lệ 1–100; status nhận `confirmed` hoặc `cancelled`. Field query khác, kể cả `userId` và `actorSub`, bị từ chối. Page và offset phải là số nguyên an toàn. Thứ tự cố định `created_at DESC, id DESC`; total được tính sau filter owner/status, kể cả khi trang yêu cầu không còn dữ liệu.

Ví dụ lấy trang thứ hai của booking đã hủy:

```http
GET /api/v1/client/bookings?status=cancelled&page=2&limit=5
Authorization: Bearer <access_token>
```

Hai API lookup UUID ứng dụng bằng `sub` đã xác minh qua `UsersQueryApi`. Chưa có hồ sơ trả 409 `USER_NOT_PROVISIONED`; thao tác đọc không tạo hồ sơ. Detail trả 404 `BOOKING_NOT_FOUND` nếu không tồn tại, 403 `BOOKING_OWNER_REQUIRED` nếu khác owner. Admin cũng chịu owner policy. Booking confirmed/cancelled vẫn đọc được khi phòng đã inactive.

## Phân lớp

- [Request DTO](../../src/bookings/presentation/client/list-bookings-request.dto.ts) validate query; UUID được validate bằng Pipe. Guard chịu trách nhiệm JWT và role.
- [Controller](../../src/bookings/presentation/client/bookings.controller.ts) map principal/query sang input thuần, map model sang response DTO và `PaginatedResponse`; interceptor tạo envelope một lần.
- [BookingsService](../../src/bookings/application/bookings.service.ts) kiểm tra pagination/status bằng policy thuần, resolve UUID người gọi và truyền owner filter vào read port. Detail quyết định not-found/owner trong application, không đặt các quyết định này ở repository.
- [Read port](../../src/bookings/application/ports/booking-read-repository.port.ts) nhận UUID và filter thuần, trả `BookingPage` hoặc `Booking | null`. Port được inject bằng `BOOKING_READ_REPOSITORY`; không dùng write UoW cho thao tác đọc.
- [Read adapter](../../src/bookings/infrastructure/typeorm-booking-read.repository.ts) dùng DataSource singleton. List áp dụng owner/status trước sort/offset/limit. Detail SELECT theo ID, không join phòng hoặc loại booking theo trạng thái phòng. Adapter ghi và đọc dùng chung [entity mapper](../../src/bookings/infrastructure/booking.mapper.ts).

Service chỉ nhận danh tính từ input đã map; UUID owner luôn được resolve qua Users:

```ts
const query = normalizeBookingList(input);
const user = await this.users.requireBySub(query.actorSub);
return this.reader.listByUser({
  userId: user.id,
  page: query.page,
  limit: query.limit,
  status: query.status,
});
```

## Snapshot và lỗi

List dùng transaction `REPEATABLE READ` nội bộ adapter để SELECT items và COUNT nhìn cùng một snapshot khi create/cancel xảy ra đồng thời. Transaction không lấy row lock; manager chỉ tồn tại trong callback. Detail dùng một SELECT thông thường. Các luồng ghi giữ nguyên UoW, isolation và protocol khóa hiện có.

DTO/Pipe trả 400 `HTTP_400` cho query/UUID sai. Application trả 400 `INVALID_BOOKING_QUERY` cho pagination/status sai khi gọi ngoài HTTP hoặc offset vượt giới hạn an toàn. Lỗi persistence không được chuyển thành danh sách rỗng hoặc lỗi not-found; exception filter trả response 500 an toàn.

## Kiểm chứng

- Unit service/controller: UUID owner, pagination/status invariant, missing/owner, response whitelist và propagation lỗi.
- HTTP: JWT/RBAC, query giả mạo, UUID, default/limit, offset an toàn, envelope, UTC và Swagger Client/Admin.
- [PostgreSQL integration](../../test/client-booking-reads.integration.spec.ts): pagination/filter/count theo owner, tie-break ID, trang ngoài phạm vi, booking của phòng inactive, owner policy cho Admin, cancellation đã commit, snapshot khi cancel nằm giữa SELECT items/COUNT và đọc trong khi write đang giữ row lock.
- [E2E luồng đặt/hủy](booking-flow-e2e.md) kiểm tra các API cùng database và pipeline xác thực thực tế của ứng dụng.

Lệnh chạy nằm tại [README](../../README.md#build-và-test); chỉ dùng database test riêng.
