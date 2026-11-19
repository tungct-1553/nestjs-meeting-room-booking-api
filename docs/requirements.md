# Requirements và API contract

API đặt phòng họp gồm tra cứu phòng, quản lý phòng và tạo/xem/hủy booking. Keycloak quản lý tài khoản, đăng ký, đăng nhập, refresh token và role. API không nhận password hoặc phát token.

Ngoài phạm vi: frontend, upload ảnh, email notification, approval workflow, thanh toán và đồng bộ lịch bên ngoài.

## 1. Quyền truy cập và danh tính

| Nhóm API | Quyền |
|---|---|
| Health/readiness | Public |
| `/client/*` | Employee hoặc Admin |
| `/admin/*` | Admin |
| Xem chi tiết/hủy booking | Có quyền Client API và là chủ booking |

Admin có quyền Employee nhưng không được xem/hủy booking của user khác. Namespace phân chia contract HTTP; quyền thao tác được kiểm tra bằng role và owner policy.

Access token đã xác minh cung cấp Keycloak `sub`. Users đồng bộ hồ sơ theo `users.keycloak_sub = sub`, trả UUID `users.id`; UUID này được dùng làm `Booking.userId`. Client không gửi `userId` khi tạo booking. Email/display name là snapshot nullable, không dùng làm khóa định danh.

## 2. Quy tắc nghiệp vụ

### Phòng

- Chỉ phòng active được hiển thị qua Client API và nhận booking mới.
- Admin tạo, sửa và ngừng hoạt động phòng; ngừng hoạt động bằng `isActive = false`, không xóa cứng lịch sử.
- Booking đã tồn tại được giữ khi phòng chuyển inactive.
- Tên phòng được trim hai đầu và chuẩn hóa NFC trước khi kiểm tra độ dài 1–200 Unicode code point. Tên duy nhất không phân biệt hoa/thường; giữ hoa/thường và dấu để hiển thị. NFC/NFD tương đương được coi là cùng tên; dấu khác nhau vẫn phân biệt. Tên và mô tả không chứa NUL (`\u0000`).
- Capacity nhận JSON number nguyên từ 1 đến 2147483647. Description nhận string hoặc null; không gửi khi tạo được lưu null.
- PATCH phải có ít nhất một field được sửa. Field không gửi giữ nguyên; `description: null` xóa mô tả; `name`/`capacity` không nhận null. Admin được sửa thông tin phòng inactive; PATCH không nhận `isActive`.

### Booking

- Title được trim hai đầu, dài 1–200 Unicode code point và không chứa NUL (`\u0000`).
- Một booking thuộc một phòng và một user. `startAt`/`endAt` phải là ISO 8601 có timezone; `startAt < endAt` và chỉ tạo booking bắt đầu trong tương lai.
- Khoảng thời gian là `[startAt, endAt)`: booking kết thúc đúng lúc booking khác bắt đầu được phép.
- Booking `confirmed` giữ phòng; booking `cancelled` không giữ phòng. Hai booking confirmed cùng phòng không được giao nhau, kể cả khi tạo đồng thời.
- Danh sách chỉ trả booking của người gọi. Xem chi tiết và hủy yêu cầu owner; không phải owner trả 403, không tồn tại trả 404.
- Hủy chuyển trạng thái sang `cancelled`; hủy lặp lại trả booking đã hủy mà không ghi lại. Cho phép hủy khi phòng inactive hoặc lịch đã bắt đầu/kết thúc; giữ toàn bộ lịch sử.

## 3. Quy ước HTTP

Base path là `/api/v1`; các path trong bảng endpoint bên dưới tương đối với base path. API có xác thực nhận `Authorization: Bearer <access_token>`.

Response JSON, field ngày giờ serialize ISO 8601 UTC. Quy ước envelope:

| Loại response | Body |
|---|---|
| Đối tượng | `{ "data": { ... } }` |
| Danh sách | `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 0 } }` |
| Lỗi | `{ "error": { "code": "...", "message": "...", "details": [] } }` |
| Health/readiness thành công | `{ "status": "ok" }` |
| HTTP 204 | Không có body |

### Phân trang và bộ lọc

`page` là số nguyên an toàn từ 1, mặc định 1; offset `(page - 1) * limit` phải là số nguyên an toàn. `limit` là số nguyên từ 1 đến 100, mặc định 20. `meta` gồm trang hiện tại, giới hạn và tổng số bản ghi sau filter.

| Danh sách | Filter ngoài `page`/`limit` | Thứ tự |
|---|---|---|
| Phòng | `capacity`: số nguyên 1–2147483647, sức chứa tối thiểu; `search`: tìm chuỗi con theo tên | `name ASC, id ASC` |
| Booking cá nhân | `status`: `confirmed` hoặc `cancelled` | `created_at DESC, id DESC` |

Search phòng được trim/NFC trước validation, tối đa 200 Unicode code point và không chứa NUL. Chuỗi rỗng bỏ filter. Tìm không phân biệt hoa/thường theo Unicode simple-case mapping `pg_c_utf8`, phân biệt dấu; `%`, `_` và `\` là ký tự literal. List phòng và total dùng cùng database snapshot.

Áp dụng filter và thứ tự trước offset/limit. Client không điều khiển owner filter của danh sách booking.

## 4. Endpoint

Ký hiệu `User`, `Room`, `Booking` trong bảng là dữ liệu bên trong envelope `data`.

### Health và hồ sơ

| Method | Path | Quyền | Response |
|---|---|---|---|
| GET | `/health` | Public | 200 raw health |
| GET | `/health/ready` | Public | 200 raw health; 503 nếu database không sẵn sàng |
| POST | `/client/users/sync` | Employee/Admin | 200 `User`; không có body hoặc JSON `{}`; 401 nếu thiếu `iat` hợp lệ; 503 nếu database không sẵn sàng |
| GET | `/client/users/me` | Employee/Admin | 200 `User` của người gọi |
| GET | `/admin/users/me` | Admin | 200 `User` của người gọi |

Sync lấy `sub`, email/display name và `iat` từ token đã xác minh. Request không có body hoặc JSON `{}` được chấp nhận; object có field, array/scalar/null và payload không rỗng ngoài JSON trả 400. Payload vượt 100 KiB trả 413; encoding/charset không hỗ trợ trả 415. Sync lặp hoặc đồng thời cùng `sub` giữ UUID, token cùng/cũ hơn không cập nhật snapshot. Hai endpoint `/users/me` chỉ đọc hồ sơ; thiếu hồ sơ trả 409 `USER_NOT_PROVISIONED`. Client/Admin dùng response DTO riêng; không có Admin sync endpoint. Hồ sơ Admin được cấp qua CLI. [Luồng provisioning](user-provisioning.md) mô tả thứ tự gọi và retry.

### Phòng

| Method | Path | Quyền | Input | Response |
|---|---|---|---|---|
| GET | `/client/rooms` | Employee/Admin | Query phân trang/filter phòng | 200 list `Room` active |
| GET | `/client/rooms/:id` | Employee/Admin | UUID phòng | 200 `Room`; 404 nếu không tồn tại/inactive |
| POST | `/admin/rooms` | Admin | `name`, `capacity`, `description?` | 201 `Room`; 400 nếu invalid; 409 nếu trùng tên |
| PATCH | `/admin/rooms/:id` | Admin | `name?`, `capacity?`, `description?` | 200 `Room`; 400 nếu UUID/body invalid; 404 nếu không tồn tại; 409 nếu trùng tên |
| DELETE | `/admin/rooms/:id` | Admin | UUID phòng | 204; 404 nếu không tồn tại |

`DELETE` ngừng hoạt động phòng. Phòng đã inactive vẫn hoàn tất thao tác với 204.

### Booking

| Method | Path | Quyền | Input | Response |
|---|---|---|---|---|
| POST | `/client/bookings` | Employee/Admin | `roomId`, `title`, `startAt`, `endAt` | 201 `Booking`; 404 nếu phòng không khả dụng; 409 nếu trùng lịch |
| GET | `/client/bookings` | Employee/Admin | Query phân trang/filter booking | 200 list `Booking` của người gọi |
| GET | `/client/bookings/:id` | Chủ booking | UUID booking | 200 `Booking`; 403 nếu không phải owner; 404 nếu không tồn tại |
| DELETE | `/client/bookings/:id` | Chủ booking | UUID booking | 200 `Booking` cancelled; 403 nếu không phải owner; 404 nếu không tồn tại |

## 5. Response model

| Model | Field | Kiểu |
|---|---|---|
| User | `id` | UUID ứng dụng |
| | `email`, `displayName` | `string \| null` |
| Room | `id` | UUID |
| | `name` | `string` |
| | `capacity` | Số nguyên dương |
| | `description` | `string \| null` |
| | `isActive` | `boolean` |
| Booking | `id`, `roomId`, `userId` | UUID |
| | `title` | `string` |
| | `startAt`, `endAt`, `createdAt` | ISO 8601 UTC |
| | `status` | `confirmed` hoặc `cancelled` |

Ví dụ response của `GET /api/v1/client/users/me`:

```json
{
  "data": {
    "id": "bbaf402c-a8ce-43a8-9268-0bbcbe8eaa74",
    "email": "employee@example.test",
    "displayName": "Employee Local"
  }
}
```

## 6. Lỗi

| HTTP status | Trường hợp |
|---|---|
| 400 | DTO validation, body sync không hợp lệ hoặc khoảng thời gian booking không hợp lệ |
| 401 | Thiếu access token hoặc token không hợp lệ |
| 403 | Thiếu role hoặc không phải owner booking |
| 404 | Resource không tồn tại; phòng không khả dụng khi tạo booking |
| 409 | Booking trùng lịch, tên phòng trùng hoặc chưa có hồ sơ ứng dụng |
| 413 | Payload vượt giới hạn parser; kích thước body tối đa 100 KiB |
| 415 | Parser không hỗ trợ encoding/charset của request |
| 500 | Lỗi nội bộ không dự kiến |
| 503 | Database readiness/sync không sẵn sàng hoặc lỗi lấy JWKS khi không có signing key cache khả dụng |

Role claim thiếu/sai cấu trúc được chuẩn hóa thành danh sách rỗng; quyền truy cập Client/Admin khi đó bị từ chối với 403. API không trả token hoặc chi tiết lỗi database/JWKS nội bộ.

`error.details` là danh sách thông báo validation; các lỗi khác dùng danh sách rỗng. Lỗi HTTP dùng code `HTTP_<status>`; lỗi không xác định dùng `INTERNAL_SERVER_ERROR`. Các lỗi nghiệp vụ hiện có gồm `INVALID_BOOKING_TIME`/`INVALID_BOOKING_INPUT`/`INVALID_ROOM_INPUT` (400), `BOOKING_OWNER_REQUIRED` (403), `BOOKING_NOT_FOUND` (404), `ROOM_UNAVAILABLE`/`ROOM_NOT_FOUND` (404), `BOOKING_TIME_CONFLICT`/`ROOM_NAME_CONFLICT` (409), `USER_NOT_PROVISIONED` (409), `INVALID_PROFILE_TOKEN` (401) và `PROFILE_SYNC_UNAVAILABLE` (503).

```json
{
  "error": {
    "code": "HTTP_401",
    "message": "Invalid or missing access token",
    "details": []
  }
}
```

## 7. Tiêu chí nghiệm thu

- Employee tạo và hủy booking của mình; không thể quản lý phòng hoặc truy cập booking của user khác.
- Admin sử dụng được Client API và quản lý phòng, vẫn chịu kiểm tra owner khi xem/hủy booking.
- Hai request đồng thời cho cùng phòng/khoảng giờ chỉ tối đa một request tạo thành công.
- Khoảng giờ liền nhau hợp lệ; hủy booking giải phóng lịch; ngừng hoạt động phòng giữ lịch sử.
- Hồ sơ đồng bộ theo `sub` có UUID ổn định; API không trả thông tin nhạy cảm.
- Response đúng envelope, nullability, thứ tự và giới hạn phân trang của contract.

Ranh giới module và xử lý transaction được mô tả tại [architecture.md](architecture.md); schema và constraint tại [database.md](database.md).
