# Tài liệu

| Tài liệu | Phạm vi |
|---|---|
| [Overview](overview.md) | Nội dung gốc khóa học NestJS - Xây dựng REST API |
| [Requirements](requirements.md) | Quy tắc nghiệp vụ, quyền truy cập và HTTP contract |
| [Coding standards](coding-standards.md) | Quy tắc bắt buộc về layer, dependency, pattern, style và kiểm thử |
| [Architecture](architecture.md) | Quyền sở hữu module, phân lớp, DI và transaction boundary |
| [Database](database.md) | Schema, constraint, index, migration và ACL bootstrap |
| [Implementation patterns](implementation-patterns.md) | Ví dụ sử dụng port/adapter, DI và transaction |
| [User provisioning](user-provisioning.md) | Client sync, đọc hồ sơ, retry và cấp hồ sơ Admin qua CLI |
| [Admin Room create/update](plans/admin-room-create-update.md) | Contract, luồng triển khai và kiểm thử hai API ghi phòng |
| [Room list/detail/deactivate](plans/room-read-deactivate.md) | Contract, read port, phân trang và kiểm thử ngừng hoạt động phòng |
| [ERD](database.drawio) | Entity và quan hệ dữ liệu |

## Quy cách biên soạn

- Viết cho người đọc kỹ thuật: xác định trách nhiệm, contract và quyết định triển khai; dùng ví dụ để giải thích điểm tích hợp hoặc hành vi không hiển nhiên.
- Mỗi chủ đề được mô tả tại tài liệu tương ứng; dẫn liên kết thay vì lặp API contract, schema hoặc hướng dẫn chạy.
- Ví dụ hiện trạng phải khớp code; ví dụ contract đề xuất phải ghi rõ chưa triển khai. Phân biệt contract nghiệp vụ với endpoint đã có. Cấu hình local và lệnh chạy/test nằm tại [README project](../README.md).
- [Overview](overview.md) giữ nguyên nội dung khóa học; không thêm checklist triển khai, coverage hoặc chỉ tiêu riêng của project.
