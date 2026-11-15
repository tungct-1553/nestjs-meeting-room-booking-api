# Roadmap học tập và triển khai

Theo dõi các đầu mục cần đạt hằng ngày; không chia thời gian cố định. Phạm vi dự kiến trong 10 ngày; sau khi hoàn thành sẽ tổng kết trong buổi meeting review.

- [ ] **Requirement và database design:** thống nhất API contract, role, quy tắc booking; hoàn thành draw.io và tự kiểm tra tính nhất quán.
- [ ] **Foundation và kiến trúc:** init modular monolith, cấu hình, DI, routing, DTO/validation, exception filter, logging, API versioning, Swagger và health check.
- [ ] **Identity và RBAC:** cấu hình Keycloak, đăng ký/login và refresh qua OIDC; JWT guard, roles và owner policy ở API. Thực hành custom provider, custom decorator và request lifecycle.
- [ ] **Database:** thiết kế entities/relations, repository, migration và seeder CLI; thực hành ORM và transaction.
- [ ] **Room:** hoàn thành CRUD theo contract và pagination.
- [ ] **Booking:** tạo/xem/hủy booking; xử lý tranh chấp ghi, kiểm tra trùng lịch và tối ưu query, tránh N+1.
- [ ] **Testing và vận hành:** unit test controller/service với Testing Module, e2e test bằng Supertest, debug, serialization/interceptor, rate limiting, CORS và graceful shutdown.
- [ ] **Review:** chạy SunLint, sửa 100% error, chụp evidence, xử lý review comments và merge PR theo quy định khóa học.

Mục tiêu dự kiến **80% line coverage cho unit tests**, dùng làm mục tiêu nội bộ của project. Ưu tiên test có ý nghĩa cho quyền truy cập, validation và concurrency hơn chỉ đạt con số coverage.

Cấu trúc PR dự kiến: tài liệu → foundation → identity → database → Room → Booking → testing/hardening. Tách PR nhỏ hơn theo từng API khi cần; không ép số lượng PR làm giảm khả năng review.

**Nội dung khóa học ngoài scope hiện tại:** xử lý file, gửi mail qua Bull/Redis và schedule chưa được triển khai trong Booking project.
