# Booking flow E2E

Chạy [booking-flow.e2e-spec.ts](../../test/booking-flow.e2e-spec.ts) với PostgreSQL 17+ UTF-8, database test riêng có quyền tạo schema và extension:

```bash
TEST_DATABASE_URL='<PostgreSQL test URL>' npm run test:e2e
```

Suite khởi tạo `AppModule`, migration và pipeline HTTP giống bootstrap ứng dụng. Chỉ thay connection bằng DataSource của schema test và cấu hình issuer bằng JWKS local. JWT được ký RS256; guard xác minh chữ ký, issuer, audience và role như request thật. Không mock service, repository hoặc transaction; không kiểm thử màn hình đăng nhập hay cấu hình realm Keycloak.

Employee được khởi tạo qua `POST /client/users/sync`. Hồ sơ Admin được chuẩn bị bằng Users application service trước mỗi test, tương ứng provisioning ngoài Client API. Schema có tên ngẫu nhiên, được xóa khi suite kết thúc; không dùng database local của ứng dụng.

| Luồng | Kiểm chứng |
|---|---|
| Tạo phòng → sync user → tra cứu → đặt → xem → hủy → đặt lại | Response/envelope, filter trạng thái, hủy idempotent, giải phóng slot và giữ lịch sử |
| JWT, role và provisioning | 401/403 trước xử lý nghiệp vụ; hồ sơ thiếu trả 409, sync xong đọc được |
| Nhiều owner, gồm Admin | List và total chỉ thuộc người gọi; detail/cancel khác owner trả 403; query không được đổi owner |
| Ngừng hoạt động phòng | 204 rỗng; phòng không còn trong Client API, booking vẫn đọc/hủy được và không tạo booking mới |
| Hai request đặt cùng slot | Một 201, một 409; slot liền kề được chấp nhận |

`test:e2e` chạy riêng với `npm test` và `test:integration`; không chạy lặp suite qua các runner.
