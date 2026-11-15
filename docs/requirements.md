# Requirements và API contract

**Trạng thái:** đặc tả làm cơ sở triển khai và tự kiểm tra. Tài liệu này thay thế tạm requirement sheet; đối chiếu mẫu của khóa học khi có link.

## Đối tượng và phạm vi

- **Employee:** xem phòng, đặt phòng, xem và hủy booking của chính mình.
- **Admin:** có quyền Employee; tạo, sửa và ngừng hoạt động phòng. Không tự động có quyền xem hoặc hủy booking của người khác trong phiên bản đầu.
- **Keycloak:** quản lý đăng ký, đăng nhập, refresh token và role. Không tạo API NestJS riêng để nhận password hoặc phát token.
- Ngoài phạm vi: upload ảnh, thông báo qua email, workflow duyệt booking, thanh toán, đồng bộ lịch bên ngoài và frontend. Các kỹ năng file, gửi mail và schedule được nêu riêng trong yêu cầu khóa học, chưa thuộc scope nghiệp vụ hiện tại.

## Quy tắc nghiệp vụ

1. Một booking thuộc một phòng và một user; `startAt` và `endAt` là thời điểm ISO 8601 có timezone, lưu UTC. `startAt < endAt`; chỉ cho phép tạo booking bắt đầu trong tương lai.
2. Khoảng thời gian dùng `[startAt, endAt)`: booking kết thúc đúng lúc booking khác bắt đầu không trùng. Booking đã hủy không giữ phòng.
3. Hai booking đang hoạt động của cùng phòng không được giao nhau, kể cả khi tạo đồng thời. Database là lớp bảo đảm cuối cùng; lỗi tranh chấp trả 409.
4. Chỉ chủ booking được xem chi tiết và hủy booking; hủy lặp lại trả booking đã hủy. Chỉ admin được quản lý phòng. User không hợp lệ/thiếu token trả 401; không đủ quyền trả 403.
5. Phòng ngừng hoạt động không nhận booking mới; booking đã tồn tại được giữ lại. Xóa phòng bằng cách chuyển trạng thái inactive, không xóa cứng lịch sử.

## Quy ước API

- Base path `/api/v1`; request xác thực dùng `Authorization: Bearer <access_token>` từ Keycloak.
- JSON response; ngày giờ trả ISO 8601 UTC. List dùng `page` mặc định 1, `limit` mặc định 20, tối đa 100; response `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 0 } }`.
- Response một đối tượng: `{ "data": { ... } }`; lỗi: `{ "error": { "code": "...", "message": "...", "details": [] } }`. Validation trả 400, không tồn tại 404, xung đột thời gian 409.
- `User`: `{ "id": "uuid", "displayName": "...", "email": "..." }`; `Room`: `{ "id": "uuid", "name": "...", "capacity": 10, "description": null, "isActive": true }`; `Booking`: `{ "id": "uuid", "roomId": "uuid", "userId": "uuid", "title": "...", "startAt": "...Z", "endAt": "...Z", "status": "confirmed", "createdAt": "...Z" }`.

| Method | Endpoint | Quyền | Params / body | Response dự kiến |
|---|---|---|---|---|
| GET | `/health` | Public | Không | 200 `{ "status": "ok" }` |
| GET | `/users/me` | Đăng nhập | Không | 200 `User` |
| GET | `/rooms` | Đăng nhập | `page`, `limit`, `capacity` tối thiểu, `search` theo tên | 200 list `Room` đang active |
| GET | `/rooms/:id` | Đăng nhập | UUID phòng | 200 `Room`; 404 nếu không có/đã inactive |
| POST | `/rooms` | Admin | `name`, `capacity`, `description?` | 201 `Room`; 400 invalid |
| PATCH | `/rooms/:id` | Admin | `name?`, `capacity?`, `description?` | 200 `Room`; 404 không tồn tại |
| DELETE | `/rooms/:id` | Admin | UUID phòng | 204; ngừng hoạt động phòng; 404 không tồn tại |
| POST | `/bookings` | Đăng nhập | `roomId`, `title`, `startAt`, `endAt` | 201 `Booking`; 404 phòng không khả dụng; 409 trùng lịch |
| GET | `/bookings` | Đăng nhập | `page`, `limit`, `status?` (`confirmed`/`cancelled`) | 200 list `Booking` của user hiện tại |
| GET | `/bookings/:id` | Chủ booking | UUID booking | 200 `Booking`; 403 không phải chủ; 404 không tồn tại |
| DELETE | `/bookings/:id` | Chủ booking | UUID booking | 200 `Booking` trạng thái `cancelled`; 403 không phải chủ; 404 không tồn tại |

Mọi endpoint yêu cầu đăng nhập có thể trả 401; endpoint Admin có thể trả 403. Response mẫu là contract dự kiến; các lỗi được trả theo quy ước chung ở trên.

## Phân quyền và bảo mật dữ liệu

User ID được lấy từ access token, không nhận `userId` từ client khi đặt phòng. Token cần hợp lệ và có audience của API; dữ liệu cá nhân chỉ chứa thông tin cần cho nghiệp vụ.

## Acceptance criteria

- Employee tạo và hủy booking của mình; không thể hủy booking của user khác hoặc quản lý phòng.
- Hai request đồng thời cho cùng phòng/khoảng thời gian chỉ tối đa một request tạo thành công.
- Khoảng thời gian liền nhau được phép; hủy booking giải phóng khoảng thời gian.
- Trang danh sách phân trang ổn định; API không trả thông tin nhạy cảm.
- Scope, endpoint và quyền được kiểm tra nhất quán với implementation.
