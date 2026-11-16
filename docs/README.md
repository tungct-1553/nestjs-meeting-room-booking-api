# Tài liệu

| Tài liệu | Phạm vi |
|---|---|
| [Overview](overview.md) | Nội dung gốc khóa học NestJS - Xây dựng REST API |
| [Requirements](requirements.md) | Quy tắc nghiệp vụ, quyền truy cập và HTTP contract |
| [Architecture](architecture.md) | Quyền sở hữu module, phân lớp, DI và transaction boundary |
| [Database](database.md) | Schema, constraint, index, migration và ACL bootstrap |
| [Implementation patterns](implementation-patterns.md) | Cách sử dụng port/adapter, DI và transaction qua code |
| [User provisioning](user-provisioning.md) | Client sync, đọc hồ sơ, retry và cấp hồ sơ Admin qua CLI |
| [ERD](database.drawio) | Entity và quan hệ dữ liệu |

## Quy cách biên soạn

- Viết cho người đọc kỹ thuật: xác định trách nhiệm, contract và quyết định triển khai; dùng ví dụ để giải thích điểm tích hợp hoặc hành vi không hiển nhiên.
- Mỗi chủ đề được mô tả tại tài liệu tương ứng; dẫn liên kết thay vì lặp API contract, schema hoặc hướng dẫn chạy.
- Ví dụ phải khớp code và phân biệt contract nghiệp vụ với endpoint đã có. Cấu hình local và lệnh chạy/test nằm tại [README project](../README.md).
- [Overview](overview.md) giữ nguyên nội dung khóa học; không thêm checklist triển khai, coverage hoặc chỉ tiêu riêng của project.
