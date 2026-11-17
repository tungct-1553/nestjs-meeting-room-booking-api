# Admin Room: create và update

Triển khai hai API theo [coding standards](../coding-standards.md). Contract HTTP được cập nhật tại [requirements](../requirements.md); schema hiện có được giữ nguyên.

## Contract

| API | Quyền | Thành công | Lỗi |
|---|---|---|---|
| `POST /api/v1/admin/rooms` | Admin | 201, `{ data: Room }` | 400 dữ liệu sai; 409 trùng tên |
| `PATCH /api/v1/admin/rooms/:id` | Admin | 200, `{ data: Room }` | 400 UUID/dữ liệu sai; 404 không có phòng; 409 trùng tên |

Thiếu/sai token trả 401; Employee trả 403. Response `Room` gồm `id`, `name`, `capacity`, `description`, `isActive`. Danh tính và quyền lấy từ JWT đã xác minh, không lấy từ body.

| Field | Create | Update |
|---|---|---|
| `name` | Bắt buộc string, trim hai đầu, dài 1–200 ký tự Unicode | Không gửi giữ nguyên; gửi áp dụng cùng quy tắc |
| `capacity` | Bắt buộc số nguyên từ 1 đến 2147483647 | Không gửi giữ nguyên; gửi áp dụng cùng giới hạn |
| `description` | String hoặc null; không gửi lưu null | Không gửi giữ nguyên; null xóa mô tả; string lưu đúng nội dung |
| `isActive` | Application đặt true | Không được nhận từ body |

JSON number được dùng cho capacity; không ép chuỗi số thành number. `null` không hợp lệ với name/capacity. Body chỉ được chứa các field được công bố; PATCH phải có ít nhất một field có thể sửa. Chuỗi mô tả rỗng được chấp nhận.

Name/description không được chứa NUL (`\u0000`) vì PostgreSQL text không lưu được ký tự này. Giới hạn tên tính theo Unicode code point và áp dụng sau trim; không thêm giới hạn riêng cho description ngoài body limit chung. Giới hạn tên giữ kích thước khóa UNIQUE trong phạm vi index PostgreSQL.

Tên duy nhất theo constraint `rooms_name_key`, phân biệt hoa/thường như database hiện tại. Không chuẩn hóa dữ liệu phòng cũ. Trùng tên trả `ROOM_NAME_CONFLICT` có kind `conflict`; tên giữ nguyên khi update không gây conflict. Input không hợp lệ tại application trả lỗi kind `invalid_input`; lỗi SQL khác không được đổi thành conflict.

Admin có thể sửa phòng inactive. PATCH giữ `id`, `isActive` và booking hiện có; không cung cấp chức năng activate/deactivate. Với hai PATCH đồng thời, các field khác nhau được giữ; cùng field nhận giá trị của thao tác cập nhật sau theo thứ tự khóa.

## Phân chia code

```text
src/rooms/
├── presentation/admin/
│   ├── rooms.controller.ts
│   ├── create-room-request.dto.ts
│   ├── update-room-request.dto.ts
│   └── room-response.dto.ts
├── application/
│   ├── rooms.service.ts
│   ├── inputs/                    # CreateRoomInput, UpdateRoomInput
│   ├── models/                    # Room đầy đủ, RoomSnapshot cho khóa
│   ├── policies/                  # Validation/normalization thuần, dùng lại constants
│   ├── errors/room.errors.ts
│   └── ports/                     # Tạo phòng nguyên tử và truy cập trong transaction
└── infrastructure/
    ├── typeorm-room-creation.repository.ts
    ├── typeorm-room.repository.ts
    ├── typeorm-rooms-unit-of-work.ts
    └── postgres-room-error.ts
```

Controller khai báo route, role, DTO và Swagger; map input/response tường minh. Application nhận input thuần, quyết định active mặc định, invariant và lỗi không tìm thấy. Adapter map entity sang model thuần và triển khai truy vấn/khóa. Không thêm dependency package hoặc export service/repository Rooms sang module khác.

Create dùng một port insert nguyên tử qua DataSource singleton; không cần một UoW mới. Update/deactivate dùng RoomsUnitOfWork hiện có và cùng protocol row lock. Factory truy cập Rooms từ Bookings tiếp tục chỉ cung cấp snapshot cần cho booking.

Decorator response chung được mở rộng tối thiểu để Swagger khai báo 201 cho POST và giữ mặc định 200 cho các API đã có. Swagger chỉ công bố hai route mới trong Admin document.

## Luồng create

1. JWT/Roles guards xác thực và kiểm tra Admin.
2. DTO/Pipe validate cấu trúc và field; controller map sang CreateRoomInput.
3. Service kiểm tra invariant, trim name, đặt description mặc định null và isActive true.
4. Creation repository insert và trả Room; UNIQUE tại database bảo vệ cả request đồng thời.
5. Adapter chỉ map SQLSTATE `23505` của `rooms_name_key` sang RoomNameConflictError; giữ cause nội bộ.
6. Controller map RoomResponseDto; interceptor tạo envelope, trả 201.

Không dùng SELECT kiểm tra tên trùng trước INSERT.

## Luồng update

1. JWT/Roles guards kiểm tra Admin; Pipe validate UUID và DTO PATCH.
2. Controller map id và các field được phép sang UpdateRoomInput, phân biệt undefined với null.
3. Service validate patch, mở callback RoomsUnitOfWork.
4. Repository khóa row bằng `SELECT ... FOR UPDATE`; thiếu row trả null để service ném RoomNotFoundError.
5. Repository UPDATE chỉ các field có trong patch và trả đầy đủ Room. Không ghi lại snapshot cũ của các field khác hoặc isActive.
6. UoW commit; lỗi unique đã biết được map bên ngoài lời gọi transaction, lỗi khác ném tiếp sau khi transaction xử lý lỗi.
7. Controller map response và trả 200.

Row lock được giữ đến commit/rollback; repository của callback chỉ dùng EntityManager được bind. Không gọi mạng hoặc lấy repository ngoài transaction trong callback.

## Thứ tự thực hiện

| Bước | Nội dung | Kiểm chứng |
|---|---|---|
| 1 | Model/input/policy/error contract và contract HTTP | Typecheck; thống nhất undefined/null, unique, trạng thái |
| 2 | Create từ persistence đến service/controller/Swagger | UT create, HTTP 201/400/401/403/409 |
| 3 | Update qua UoW/row lock và partial update | UT update, HTTP 200/400/404/409 |
| 4 | PostgreSQL integration và hồi quy | Atomic unique, rollback, không mất field, bảo toàn inactive/booking |
| 5 | Lint/format/architecture/build và review độc lập | Sửa finding, chạy lại checks chịu ảnh hưởng |

Khung 3 giờ: 15 phút contract; 65 phút hai luồng API; 40 phút UT/HTTP; 30 phút PostgreSQL integration; 30 phút checks/review và xử lý finding.

## Test

- **Controller UT:** map request/input, id, null/undefined và response whitelist; gọi đúng use case; lỗi application được chuyển tiếp.
- **Service UT:** create active/default description; input sai không ghi; update thiếu phòng, patch rỗng, giữ field bỏ qua, cho phép xóa description và sửa phòng inactive; thứ tự lock trước update.
- **HTTP:** token/role, JSON body sai kiểu, field lạ, tên toàn khoảng trắng/200–201 ký tự/Unicode, NUL trong text, capacity biên/sai kiểu, UUID sai, null, empty patch, status/envelope và Swagger 201/200; Admin routes không xuất hiện trong Client document.
- **PostgreSQL:** create/read row, duplicate create đồng thời, đổi sang tên đã có, update rollback, giữ UUID/isActive/booking, cập nhật đồng thời field khác nhau và cạnh tranh với deactivate; unique violation khác không bị đổi thành lỗi trùng tên.
- **Hồi quy:** toàn bộ tests hiện có của Users, Identity, parser/CORS, booking/deactivate và architecture.

Unit test mock port; HTTP test chạy Nest pipeline; integration test dùng database/container test riêng. Mock không được dùng làm bằng chứng cho row lock hoặc UNIQUE khi có tranh chấp.

## Review

Subagent triển khai hoàn tất và dừng ghi file trước khi subagent khác review. Reviewer đối chiếu coding standards, contract, dependency, transaction, validation, mapping lỗi, Swagger, style và chất lượng test. Chỉ chốt hoàn tất khi không còn finding cần sửa và các checks đạt.
