# Meeting Room Booking API

Mock Project backend đặt phòng họp, xây dựng bằng NestJS theo kiến trúc **modular monolith**. Nhân viên có thể xem phòng, đặt và hủy lịch của mình; admin quản lý phòng. Keycloak phụ trách tài khoản và xác thực.

Trạng thái: **đang đặc tả**, chưa có ứng dụng hoặc API chạy được. Project được tự kiểm tra trong quá trình thực hiện và tổng kết sau khi hoàn thành.

## Tài liệu

- [Requirements và API contract](docs/requirements.md)
- [Kiến trúc và bảo mật](docs/architecture.md)
- [Thiết kế database](docs/database.md) · [Sơ đồ draw.io](docs/database.drawio)
- [Roadmap và mục tiêu học tập](docs/roadmap.md)

## Phạm vi

Room management, booking chống trùng lịch, RBAC, unit test và e2e test. Phiên bản đầu không có upload ảnh, notification, approval workflow, thanh toán hoặc frontend.

API contract và database design là cơ sở triển khai, được cập nhật khi có thay đổi nghiệp vụ.
