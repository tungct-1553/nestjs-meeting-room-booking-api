# Roadmap học tập và triển khai

Checkbox thể hiện hoàn thành toàn bộ đầu mục; dòng ghi rõ các phần đã có nếu đầu mục còn dở. Theo dõi các đầu mục cần đạt hằng ngày; không chia thời gian cố định. Phạm vi dự kiến trong 10 ngày; sau khi hoàn thành sẽ tổng kết trong buổi meeting review.

- [x] **Requirement và database design:** có API contract v1, role nghiệp vụ, quy tắc booking, ERD và quy ước nguồn chuẩn của từng tài liệu. Cấu hình role Keycloak sẽ được thực hiện trong đầu mục Identity.
- [x] **Foundation và kiến trúc:** init modular monolith, cấu hình, DI, routing, DTO/validation, exception filter, logging, API versioning, Swagger và health check.
- [ ] **Identity và RBAC:** cấu hình Keycloak, đăng ký/login và refresh qua OIDC; JWT guard, roles và owner policy ở API. Thực hành custom provider, custom decorator và request lifecycle.
- [ ] **Database:** đã có entity, FK/constraint qua migration SQL, repository, CLI migration và transaction; còn seeder CLI và kiểm thử CHECK/FK/index trực tiếp. Migration policy tại database.md.
- [ ] **Room:** đã có core deactivate và API factory khóa phòng; còn HTTP CRUD, truy vấn/list và phân trang theo contract.
- [ ] **Booking:** đã có core create, transaction và chống trùng lịch; còn HTTP tạo/xem/hủy, owner policy và query danh sách.
- [ ] **Testing và vận hành:** đã có unit/HTTP foundation tests và PostgreSQL integration tests, envelope, CORS và shutdown hooks; còn test JWT/RBAC/owner và API nghiệp vụ, rate limiting cùng kiểm chứng vận hành đầy đủ.
- [ ] **Review:** chạy SunLint, sửa 100% error, chụp evidence, xử lý review comments và merge PR theo quy định khóa học.

Mục tiêu dự kiến **80% line coverage cho unit tests**, dùng làm mục tiêu nội bộ của project. Ưu tiên test có ý nghĩa cho quyền truy cập, validation và concurrency hơn chỉ đạt con số coverage.

Cấu trúc PR dự kiến: tài liệu → foundation → identity → database → Room → Booking → testing/hardening. Tách PR nhỏ hơn theo từng API khi cần; không ép số lượng PR làm giảm khả năng review.

**Nội dung khóa học ngoài scope hiện tại:** xử lý file, gửi mail qua Bull/Redis và schedule chưa được triển khai trong Booking project.
