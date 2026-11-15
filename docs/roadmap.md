# Roadmap học tập và triển khai

Theo dõi các đầu mục cần đạt hằng ngày; không chia thời gian cố định. Phạm vi dự kiến trong 10 ngày, cần điều chỉnh theo review của mentor.

- [ ] **Requirement và database design:** thống nhất API contract, role, quy tắc booking; hoàn thành draw.io và nhận review từ mentor.
- [ ] **Foundation và kiến trúc:** init modular monolith, cấu hình, DI, routing, DTO/validation, exception filter, logging, API versioning, Swagger và health check.
- [ ] **Identity và RBAC:** cấu hình Keycloak, đăng ký/login và refresh qua OIDC; JWT guard, roles và owner policy ở API. Thực hành custom provider, custom decorator và request lifecycle.
- [ ] **Database:** thiết kế entities/relations, repository, migration và seeder CLI; thực hành ORM và transaction.
- [ ] **Room:** hoàn thành CRUD theo contract và pagination.
- [ ] **Booking:** tạo/xem/hủy booking; xử lý tranh chấp ghi, kiểm tra trùng lịch và tối ưu query, tránh N+1.
- [ ] **Testing và vận hành:** unit test controller/service với Testing Module, e2e test bằng Supertest, debug, serialization/interceptor, rate limiting, CORS và graceful shutdown.
- [ ] **Review:** chạy SunLint, sửa 100% error, chụp evidence, xử lý review comments và merge PR theo quy định khóa học.

Mục tiêu dự kiến **80% line coverage cho unit tests**, chờ mentor xác nhận yêu cầu chính thức. Ưu tiên test có ý nghĩa cho quyền truy cập, validation và concurrency hơn chỉ đạt con số coverage.

Cấu trúc PR dự kiến: tài liệu → foundation → identity → database → Room → Booking → testing/hardening. Tách PR nhỏ hơn theo từng API nếu mentor yêu cầu; không ép số lượng PR làm giảm khả năng review.

**Cần thống nhất với mentor:** yêu cầu khóa học có nêu xử lý file, gửi mail qua Bull/Redis và schedule. Các nội dung này chưa được đưa vào scope Booking; cần xác nhận có thể thực hành riêng hoặc yêu cầu tối thiểu cần bổ sung.
