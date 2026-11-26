# Demo đặt phòng họp và checklist API

**`master` có đủ 20 endpoint** cho demo đặt phòng và vòng đời phòng Admin. Ba API tra cứu và đổi trạng thái phòng đã được merge trong PR #11. [API contract](requirements.md)

## Chuẩn bị

1. Chạy PostgreSQL, Keycloak, migrations và API từ `master`. [Hướng dẫn chạy local](../README.md#chạy-local)
2. Mở [Admin Swagger](http://localhost:3000/api/v1/docs/admin) với `admin@example.test` và [Client Swagger](http://localhost:3000/api/v1/docs/client) với `employee@example.test`. Dùng hai phiên trình duyệt riêng để tách phiên đăng nhập Keycloak. Password lấy từ `.env`.
3. Gọi `GET /api/v1/health/ready` và kiểm tra `200 { "status": "ok" }`.

## Luồng demo chính

Thời lượng 5–7 phút. Tất cả endpoint trong bảng có prefix `/api/v1`. Dùng hai khung giờ liền nhau và một tên phòng mới cho mỗi lần demo.

| Khung | `startAt` | `endAt` |
|---|---|---|
| A · 09:00–10:00 (+07:00) | `2099-01-01T02:00:00Z` | `2099-01-01T03:00:00Z` |
| B · 10:00–11:00 (+07:00) | `2099-01-01T03:00:00Z` | `2099-01-01T04:00:00Z` |

| Bước | Vai trò | Endpoint và dữ liệu | Kết quả cần thấy |
|---:|---|---|---|
| 1 | Admin | `POST /admin/rooms` với `{"name":"Demo Lotus","capacity":8}`. Đổi tên nếu đã dùng trước đó | `201`, lưu `data.id` làm `roomId` |
| 2 | Employee | `POST /client/users/sync` với body rỗng. Gọi `GET /client/rooms/available` với khung A và `capacity=8` | Cả hai trả `200`. Danh sách có phòng vừa tạo |
| 3 | Employee | `POST /client/bookings` với `roomId`, `title="Sprint planning"`, `startAt` và `endAt` của khung A. Gửi lại cùng request | Lần đầu `201`, lưu `data.id` làm `bookingId`. Lần hai `409 BOOKING_TIME_CONFLICT` |
| 4 | Employee | `GET /client/rooms/:id/availability` với `id=roomId`, từ đầu khung A đến cuối khung B | `200`, `data.availableIntervals` chỉ có khung B |
| 5 | Employee | `PATCH /client/bookings/:id/schedule` với `id=bookingId` và body gồm `startAt`, `endAt` của khung B. Tìm lại bằng `GET /client/rooms/available` cho khung A | Cả hai trả `200`. Booking đổi giờ, giữ nguyên ID. Danh sách khung A có phòng vừa được giải phóng |
| 6 | Employee | `DELETE /client/bookings/:id` rồi `GET /client/bookings/:id` với `id=bookingId` | Cả hai trả `200`. Chi tiết vẫn có booking với `status=cancelled` |

**Kiểm tra rollback khi cần demo thêm.** Sau bước 4, tạo booking thứ hai ở khung B, rồi thử đổi booking đầu sang B. PATCH trả `409 BOOKING_TIME_CONFLICT`. Gọi GET detail và xác nhận booking đầu vẫn ở A. Hủy booking thứ hai rồi tiếp tục bước 5.

## Demo vòng đời phòng Admin

Dùng lại `roomId` và `bookingId` sau bước 6.

| Bước | Vai trò | Endpoint và dữ liệu | Kết quả cần thấy |
|---:|---|---|---|
| 1 | Admin | `DELETE /admin/rooms/:id` với `id=roomId` | `204`, phòng chuyển inactive |
| 2 | Admin | `GET /admin/rooms` với `isActive=false` và `search` bằng tên phòng demo. Gọi `GET /admin/rooms/:id` với `id=roomId` | Cả hai trả `200`. Danh sách có phòng, chi tiết trả `isActive=false` |
| 3 | Employee | `GET /client/rooms/:id` với `id=roomId` | `404` khi phòng inactive |
| 4 | Admin | `PATCH /admin/rooms/:id/status` với `id=roomId` và body `{"isActive":true}` | `200`, phòng trả về có `isActive=true` |
| 5 | Employee | `GET /client/rooms/:id` với `id=roomId`. Gọi `POST /client/bookings` đặt lại khung A với title mới. Đọc booking cũ qua `GET /client/bookings/:id` với `id=bookingId` | Phòng xuất hiện lại, booking mới trả `201`, booking cũ vẫn có `status=cancelled` |

## Checklist endpoint

Đường dẫn dùng chung prefix `/api/v1`. Cột Demo ghi bước sử dụng, gồm cả chuẩn bị và các bước mở rộng.

| Nhóm | Endpoint | Trạng thái | Demo |
|---|---|---|---|
| Vận hành | `GET /health` | Đã triển khai | |
| Vận hành | `GET /health/ready` | Đã triển khai | Chuẩn bị |
| Hồ sơ | `POST /client/users/sync` | Đã triển khai | Bước 2 |
| Hồ sơ | `GET /client/users/me` | Đã triển khai | |
| Hồ sơ | `GET /admin/users/me` | Đã triển khai | |
| Phòng | `GET /admin/rooms` | Đã triển khai · PR #11 | Vòng đời phòng |
| Phòng | `GET /admin/rooms/:id` | Đã triển khai · PR #11 | Vòng đời phòng |
| Phòng | `POST /admin/rooms` | Đã triển khai | Bước 1 |
| Phòng | `PATCH /admin/rooms/:id` | Đã triển khai | |
| Phòng | `PATCH /admin/rooms/:id/status` | Đã triển khai · PR #11 | Vòng đời phòng |
| Phòng | `DELETE /admin/rooms/:id` | Đã triển khai | Vòng đời phòng |
| Phòng | `GET /client/rooms` | Đã triển khai | |
| Phòng | `GET /client/rooms/:id` | Đã triển khai | Vòng đời phòng |
| Phòng | `GET /client/rooms/available` | Đã triển khai · PR #9 | Bước 2, 5 |
| Phòng | `GET /client/rooms/:id/availability` | Đã triển khai · PR #9 | Bước 4 |
| Booking | `POST /client/bookings` | Đã triển khai | Bước 3 |
| Booking | `GET /client/bookings` | Đã triển khai · PR #8 | |
| Booking | `GET /client/bookings/:id` | Đã triển khai · PR #8 | Bước 6 |
| Booking | `PATCH /client/bookings/:id/schedule` | Đã triển khai · PR #9 | Bước 5 |
| Booking | `DELETE /client/bookings/:id` | Đã triển khai | Bước 6 |
