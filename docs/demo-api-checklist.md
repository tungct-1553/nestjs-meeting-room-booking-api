# Demo đặt phòng họp và checklist API

**Demo chính đã đủ API.** Nhánh `feat/room-availability-booking-reschedule` có 17 endpoint theo hợp đồng hiện tại, gồm hai API đọc booking của PR #8 và ba API tra cứu giờ trống, đổi lịch của PR #9. Ba endpoint Admin đề xuất phục vụ demo mở lại phòng đã ngừng hoạt động. [API contract](requirements.md)

## Chuẩn bị

1. Chạy PostgreSQL, Keycloak, migrations và API từ nhánh chứa PR #9. [Hướng dẫn chạy local](../README.md#chạy-local)
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

**Kiểm tra ngừng hoạt động phòng khi cần demo thêm.** Sau bước 6, Admin gọi `DELETE /admin/rooms/:id` với `id=roomId` và nhận `204`. Employee gọi `GET /client/rooms/:id` nhận `404`, còn `GET /client/bookings/:id` vẫn trả booking đã hủy.

## Checklist endpoint

Đường dẫn dùng chung prefix `/api/v1`. Cột Demo ghi bước sử dụng, gồm cả chuẩn bị và các bước mở rộng.

| Nhóm | Endpoint | Trạng thái | Demo |
|---|---|---|---|
| Vận hành | `GET /health` | Đã triển khai | |
| Vận hành | `GET /health/ready` | Đã triển khai | Chuẩn bị |
| Hồ sơ | `POST /client/users/sync` | Đã triển khai | Bước 2 |
| Hồ sơ | `GET /client/users/me` | Đã triển khai | |
| Hồ sơ | `GET /admin/users/me` | Đã triển khai | |
| Phòng | `POST /admin/rooms` | Đã triển khai | Bước 1 |
| Phòng | `PATCH /admin/rooms/:id` | Đã triển khai | |
| Phòng | `DELETE /admin/rooms/:id` | Đã triển khai | Demo thêm |
| Phòng | `GET /client/rooms` | Đã triển khai | |
| Phòng | `GET /client/rooms/:id` | Đã triển khai | Demo thêm |
| Phòng | `GET /client/rooms/available` | Đã triển khai · PR #9 | Bước 2, 5 |
| Phòng | `GET /client/rooms/:id/availability` | Đã triển khai · PR #9 | Bước 4 |
| Booking | `POST /client/bookings` | Đã triển khai | Bước 3 |
| Booking | `GET /client/bookings` | Đã triển khai · PR #8 | |
| Booking | `GET /client/bookings/:id` | Đã triển khai · PR #8 | Bước 6 |
| Booking | `PATCH /client/bookings/:id/schedule` | Đã triển khai · PR #9 | Bước 5 |
| Booking | `DELETE /client/bookings/:id` | Đã triển khai | Bước 6 |

### API cần bổ sung cho demo mở lại phòng

| Endpoint đề xuất | Trạng thái | Tiêu chí demo |
|---|---|---|
| `GET /admin/rooms` | Chưa triển khai | Admin lọc `isActive=false` và tìm thấy phòng đã ngừng hoạt động |
| `GET /admin/rooms/:id` | Chưa triển khai | Admin xem chi tiết phòng inactive |
| `PATCH /admin/rooms/:id/status` | Chưa triển khai | Admin gửi `{"isActive":true}`, phòng xuất hiện lại trong Client API và nhận booking mới. Lịch sử booking được giữ |

Ưu tiên bàn giao demo chính từ PR #9. Nếu đưa luồng mở lại phòng vào phạm vi ngày 10, dành 6 giờ cho ba API Admin và kiểm thử, 1 giờ cho review. [PR #8](https://github.com/tungct-1553/nestjs-meeting-room-booking-api/pull/8) · [PR #9](https://github.com/tungct-1553/nestjs-meeting-room-booking-api/pull/9)
