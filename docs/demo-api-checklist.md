# Demo REST API đặt phòng họp trên Swagger

Luồng demo chạy trên `master` và bao phủ đủ 20 endpoint. Admin tạo và quản lý phòng. Employee tìm giờ trống, đặt, đổi lịch, hủy và đặt lại. [API contract](requirements.md)

## Chuẩn bị môi trường và hai phiên đăng nhập

1. Checkout `master` và chạy PostgreSQL, Keycloak, migration, bootstrap tài khoản test và NestJS. Giữ host API `http://localhost:3000` theo cấu hình redirect mặc định. [Hướng dẫn chạy local](../README.md#chạy-local)
2. Mở hai URL health trong trình duyệt. API liveness và readiness là endpoint public.

| URL | Kết quả mong đợi |
|---|---|
| [Health](http://localhost:3000/api/v1/health) | `200` với `{ "status": "ok" }` |
| [Readiness](http://localhost:3000/api/v1/health/ready) | `200` với `{ "status": "ok" }`. Nếu trả `503`, kiểm tra PostgreSQL trước khi demo |

3. Mở hai Swagger bằng hai phiên trình duyệt riêng, ví dụ cửa sổ thường cho Admin và cửa sổ ẩn danh cho Employee. Ở mỗi Swagger, bấm **Authorize**, chọn **oauth2**, giữ client ID và các scope `openid`, `profile`, `email`, rồi đăng nhập Keycloak bằng tài khoản tương ứng.

| Vai trò | Swagger | Tài khoản | Biến password trong `.env` |
|---|---|---|---|
| Admin | [Admin Swagger](http://localhost:3000/api/v1/docs/admin) | `admin@example.test` | `KEYCLOAK_TEST_ADMIN_PASSWORD` |
| Employee | [Client Swagger](http://localhost:3000/api/v1/docs/client) | `employee@example.test` | `KEYCLOAK_EMPLOYEE_PASSWORD` |

Trong Swagger, mở đúng endpoint, bấm **Try it out**, nhập path/query hoặc dán JSON vào **Request body**, rồi bấm **Execute**. Các endpoint bên dưới dùng chung prefix `/api/v1`.

Access token mặc định có hiệu lực 5 phút. Nếu nhận `401` giữa buổi demo, mở **Authorize** ở đúng Swagger, bấm **Logout** trong mục `oauth2` rồi cấp quyền lại với tài khoản tương ứng. Giữ các ID đã lưu để tiếp tục bước đang làm.

## Dữ liệu mẫu

- Dùng tên phòng `Demo Lotus D1`. Khi demo lại, đổi hậu tố `D1` và dùng cùng tên mới cho các query `search`.
- Thay `ROOM_ID`, `BOOKING_ID` và `BLOCKER_ID` bằng `data.id` thu được tại bước tạo tương ứng.
- Dán timestamp UTC trong bảng. Hai khung giờ liền nhau theo giờ Việt Nam.

| Khung | Giờ Việt Nam | `startAt` | `endAt` |
|---|---|---|---|
| A | 09:00–10:00 | `2099-01-01T02:00:00Z` | `2099-01-01T03:00:00Z` |
| B | 10:00–11:00 | `2099-01-01T03:00:00Z` | `2099-01-01T04:00:00Z` |

## Bước 1 Kiểm tra hồ sơ

| Swagger | Endpoint | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| Admin | `GET /admin/users/me` | Bấm **Execute** | `200`, `data.email` là `admin@example.test` |
| Client | `POST /client/users/sync` | Để body trống rồi bấm **Execute** | `200`, trả hồ sơ Employee và UUID ứng dụng |
| Client | `GET /client/users/me` | Bấm **Execute** | `200`, `data.id` trùng với ID từ sync và `data.email` là `employee@example.test` |

## Bước 2 Tạo và cập nhật phòng

1. Trong Admin Swagger, gọi `POST /admin/rooms` với body sau. Kỳ vọng `201`, `isActive=true`. Lưu `data.id` thành `ROOM_ID`.

```json
{
  "name": "Demo Lotus D1",
  "capacity": 8,
  "description": "Room for manual booking demo"
}
```

2. Gọi `PATCH /admin/rooms/:id` với `id=ROOM_ID` và body sau. Kỳ vọng `200`, `data.capacity=12` và `data.description` có giá trị mới.

```json
{
  "capacity": 12,
  "description": "Projector and whiteboard"
}
```

3. Gọi `GET /admin/rooms` với `page=1`, `limit=20`, `capacity=12`, `search=Demo Lotus D1`, `isActive=true`. Kỳ vọng `200 { data, meta }` và tìm thấy `ROOM_ID`.
4. Gọi `GET /admin/rooms/:id` với `id=ROOM_ID`. Kỳ vọng `200`, `capacity=12`, `isActive=true`.

## Bước 3 Tìm phòng và giờ trống

Chuyển sang Client Swagger.

| Endpoint | Dữ liệu nhập | Kết quả mong đợi |
|---|---|---|
| `GET /client/rooms` | `page=1`, `limit=20`, `capacity=12`, `search=Demo Lotus D1` | `200`, danh sách có `ROOM_ID` |
| `GET /client/rooms/:id` | `id=ROOM_ID` | `200`, chi tiết có `isActive=true` |
| `GET /client/rooms/available` | `startAt=2099-01-01T02:00:00Z`, `endAt=2099-01-01T03:00:00Z`, `capacity=12`, `search=Demo Lotus D1` | `200`, phòng xuất hiện vì khung A còn trống |

## Bước 4 Đặt phòng và thử đặt trùng

1. Gọi `POST /client/bookings` với body sau, thay `ROOM_ID` bằng UUID thật. Kỳ vọng `201` và `status=confirmed`. Lưu `data.id` thành `BOOKING_ID`.

```json
{
  "roomId": "ROOM_ID",
  "title": "Sprint planning",
  "startAt": "2099-01-01T02:00:00Z",
  "endAt": "2099-01-01T03:00:00Z"
}
```

2. Bấm **Execute** lần nữa với cùng body. Kỳ vọng `409`, `error.code=BOOKING_TIME_CONFLICT`.
3. Gọi `GET /client/bookings` với `page=1`, `limit=20`, `status=confirmed`. Kỳ vọng danh sách có `BOOKING_ID`.
4. Gọi `GET /client/bookings/:id` với `id=BOOKING_ID`. Kỳ vọng `200`, `status=confirmed` và thời gian là khung A.
5. Gọi `GET /client/rooms/:id/availability` với `id=ROOM_ID`, `startAt=2099-01-01T02:00:00Z`, `endAt=2099-01-01T04:00:00Z`. Kỳ vọng `200` và `data.availableIntervals` chỉ chứa khung B.

## Bước 5 Kiểm tra rollback khi đổi lịch bị trùng

1. Gọi `POST /client/bookings` với body sau để giữ khung B. Kỳ vọng `201`, lưu `data.id` thành `BLOCKER_ID`.

```json
{
  "roomId": "ROOM_ID",
  "title": "Khung B dùng để kiểm tra xung đột",
  "startAt": "2099-01-01T03:00:00Z",
  "endAt": "2099-01-01T04:00:00Z"
}
```

2. Gọi `PATCH /client/bookings/:id/schedule` với `id=BOOKING_ID` và body dưới đây. Kỳ vọng `409 BOOKING_TIME_CONFLICT`.

```json
{
  "startAt": "2099-01-01T03:00:00Z",
  "endAt": "2099-01-01T04:00:00Z"
}
```

3. Gọi `GET /client/bookings/:id` với `id=BOOKING_ID`. Kỳ vọng `200`, booking chính vẫn ở khung A.
4. Gọi `DELETE /client/bookings/:id` với `id=BLOCKER_ID`. Kỳ vọng `200`, booking kiểm tra trùng lịch chuyển sang `cancelled` và khung B được giải phóng.

## Bước 6 Đổi lịch thành công

1. Gọi lại `PATCH /client/bookings/:id/schedule` với `id=BOOKING_ID` và cùng body khung B ở bước 5. Kỳ vọng `200`, giữ nguyên `data.id` và `roomId`, thời gian đổi sang khung B.
2. Gọi lại `GET /client/rooms/available` với dữ liệu khung A ở bước 3. Kỳ vọng `200`, `ROOM_ID` xuất hiện trở lại.
3. Gọi lại `GET /client/rooms/:id/availability` với cửa sổ từ đầu A đến cuối B ở bước 4. Kỳ vọng `200`, `data.availableIntervals` chỉ chứa khung A.

## Bước 7 Ngừng hoạt động và mở lại phòng

| Thứ tự | Swagger | Endpoint và dữ liệu | Kết quả mong đợi |
|---:|---|---|---|
| 1 | Admin | `DELETE /admin/rooms/:id` với `id=ROOM_ID` | `204`, body rỗng |
| 2 | Admin | `GET /admin/rooms` với `search=Demo Lotus D1`, `isActive=false` | `200`, danh sách có `ROOM_ID` |
| 3 | Admin | `GET /admin/rooms/:id` với `id=ROOM_ID` | `200`, `data.isActive=false` |
| 4 | Client | `GET /client/rooms/:id` với `id=ROOM_ID` | `404 ROOM_NOT_FOUND` |
| 5 | Client | `GET /client/bookings/:id` với `id=BOOKING_ID` | `200`, booking vẫn `confirmed` ở khung B |
| 6 | Admin | `PATCH /admin/rooms/:id/status` với `id=ROOM_ID` và body `{"isActive":true}` | `200`, `data.isActive=true` |
| 7 | Client | `GET /client/rooms/:id` với `id=ROOM_ID` | `200`, phòng xuất hiện lại |
| 8 | Client | `POST /client/bookings` với body khung B ở bước 5 | `409 BOOKING_TIME_CONFLICT`, booking chính vẫn giữ khung B |

## Bước 8 Hủy và đặt lại khung giờ

1. Trong Client Swagger, gọi `DELETE /client/bookings/:id` với `id=BOOKING_ID`. Kỳ vọng `200`, `data.status=cancelled`.
2. Gọi `GET /client/bookings/:id` với cùng ID. Kỳ vọng `200`, lịch sử booking vẫn được trả với trạng thái `cancelled`.
3. Gọi lại `POST /client/bookings` với body khung B ở bước 5. Kỳ vọng `201`, trả ID mới và `status=confirmed`.

## Checklist 20 endpoint

Tất cả mục dưới đây đã triển khai. Cột **Bước** trỏ tới lần gọi đầu tiên trong luồng demo.

| Nhóm | Endpoint | Bước |
|---|---|---|
| Vận hành | `GET /health` | Chuẩn bị |
| Vận hành | `GET /health/ready` | Chuẩn bị |
| Hồ sơ | `GET /admin/users/me` | 1 |
| Hồ sơ | `POST /client/users/sync` | 1 |
| Hồ sơ | `GET /client/users/me` | 1 |
| Phòng | `POST /admin/rooms` | 2 |
| Phòng | `PATCH /admin/rooms/:id` | 2 |
| Phòng | `GET /admin/rooms` | 2 |
| Phòng | `GET /admin/rooms/:id` | 2 |
| Phòng | `GET /client/rooms` | 3 |
| Phòng | `GET /client/rooms/:id` | 3 |
| Phòng | `GET /client/rooms/available` | 3 |
| Booking | `POST /client/bookings` | 4 |
| Booking | `GET /client/bookings` | 4 |
| Booking | `GET /client/bookings/:id` | 4 |
| Phòng | `GET /client/rooms/:id/availability` | 4 |
| Booking | `PATCH /client/bookings/:id/schedule` | 5 |
| Booking | `DELETE /client/bookings/:id` | 5 |
| Phòng | `DELETE /admin/rooms/:id` | 7 |
| Phòng | `PATCH /admin/rooms/:id/status` | 7 |
