# Kiến trúc và bảo mật

**Trạng thái:** đề xuất, chờ mentor review. Kiến trúc là một deployable NestJS modular monolith, một PostgreSQL cho dữ liệu ứng dụng và Redis phục vụ queue. Keycloak là identity provider chạy độc lập.

## Modules và ranh giới

| Module | Trách nhiệm | Phụ thuộc |
|---|---|---|
| Identity | Xác thực access token Keycloak, cung cấp principal và role guard | Keycloak OIDC discovery/JWKS |
| Users | Đồng bộ hồ sơ nghiệp vụ tối thiểu theo Keycloak `sub`, cung cấp current user | Identity, Users repository |
| Rooms | Quản lý, tra cứu phòng và upload ảnh | Identity, Rooms repository, file storage port |
| Bookings | Đặt/hủy phòng, phân quyền owner, chống trùng lịch | Users, Rooms, Bookings repository |
| Notifications | Lưu notification/outbox, enqueue email và xử lý reminder | PostgreSQL, Bull/Redis, email provider, schedule |
| Shared | Config, exception filter, logging, health, utilities dùng chung | Không chứa business logic feature |

Mỗi feature có NestJS Module, Controller và Provider. Controller nhận DTO, không truy cập trực tiếp repository; application service thực thi nghiệp vụ và phụ thuộc port qua DI; infrastructure cung cấp adapter cho database/file/email. Các module không import repository nội bộ của module khác: dùng exported service hoặc port. Một tiến trình triển khai, không tách microservice.

## Request lifecycle

Client → routing/versioning → JWT/RBAC guard → DTO validation pipe → controller → application service/policy → repository/transaction → response serialization/interceptor. Exception filter chuyển lỗi có kiểm soát thành error response; log có request ID và context, không log token/password. Custom decorator cung cấp current principal; custom provider và lifecycle hooks được áp dụng khi phù hợp cho kết nối/đóng tài nguyên.

## Identity, token và authorization

- Keycloak sở hữu account, đăng ký, đăng nhập, reset password và refresh token; client thực hiện OIDC Authorization Code + PKCE với Keycloak. API không nhận password hay tự phát JWT. Xem [Keycloak OIDC](https://www.keycloak.org/securing-apps/oidc-layers).
- API nhận `Authorization: Bearer`; lấy cấu hình OIDC và public keys từ issuer/JWKS, cache keys và hỗ trợ key rotation. Kiểm tra thuật toán cho phép, chữ ký, issuer, audience API, expiry và not-before; chỉ chấp nhận access token, không dùng ID/refresh token gọi API.
- Realm/client cấu hình để access token có audience API và role `admin` hoặc `employee`; role guard xác minh claim đã cấu hình. Policy/service kiểm tra owner ở server, kể cả khi request đã qua guard.
- Khi request xác thực đầu tiên vào ứng dụng, Users module upsert hồ sơ theo `sub` duy nhất từ token hợp lệ; email/display name thiếu được lưu null, không dùng email làm khóa định danh; notification thiếu email hợp lệ được đánh dấu failed và log không chứa thông tin nhạy cảm. Thay đổi quyền do Keycloak quản lý; quyền ghi nghiệp vụ vẫn do NestJS kiểm tra.
- Access token hợp lệ được xác minh offline tới khi hết hạn; không hứa revoke tức thời. TTL và refresh policy cấu hình ở Keycloak.

## Database và tính nhất quán

PostgreSQL lưu users, rooms, bookings và notification outbox. Migration bật `btree_gist` và tạo exclusion constraint theo room UUID và khoảng `tstzrange(start_at, end_at, '[)')` cho booking `confirmed`; `CHECK start_at < end_at`. Transaction ghi booking và outbox, map exclusion violation thành 409; không dựa duy nhất vào query kiểm tra trước khi insert. Tạo room/booking và quan hệ chỉ theo database design được mentor duyệt.

Pagination có thứ tự ổn định và giới hạn; index cho lookup phòng, owner và lịch. Khi cần lấy dữ liệu liên quan dùng join hoặc batch thay vì truy vấn N+1. Unit test và PostgreSQL integration test kiểm tra query, hai request đồng thời và trạng thái bị hủy.

## File và thông báo

Storage adapter lưu ảnh ngoài database; DB chỉ lưu storage key, API tạo URL truy cập phù hợp. Validate size, MIME/nội dung file và tên file nội bộ; không đưa đường dẫn từ client vào filesystem. Mặc định local storage phục vụ demo, có port để thay adapter.

Booking và outbox được ghi cùng transaction. Worker chuyển outbox thành Bull job; dùng idempotency key theo event ID, retry/backoff và log lỗi. Scheduler quét booking sắp bắt đầu, tạo reminder outbox duy nhất theo `(booking_id, type)`; job kiểm tra booking vẫn confirmed trước khi gửi. Delivery email theo mô hình **at least once**, idempotency tại ứng dụng giảm trùng; không khẳng định gửi email exactly once nếu provider không hỗ trợ idempotency. Cần cấu hình provider và khoảng nhắc trước bằng environment.

## Vận hành

ConfigModule validate biến môi trường; Swagger công bố `/api/v1` và bearer auth. CORS cấu hình origin được phép; rate limiting áp dụng API phù hợp. Health endpoint phân biệt app hoạt động và dependency readiness. Enable shutdown hooks để đóng HTTP, DB, queue và scheduler đúng thứ tự. Không đưa credentials vào git; cấu hình ví dụ chỉ dùng placeholder.
