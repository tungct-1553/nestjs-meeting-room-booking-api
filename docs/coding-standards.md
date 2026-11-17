# Quy tắc coding

Tài liệu quy định cách phân lớp, dependency và style áp dụng trong dự án. [Architecture](architecture.md) mô tả các luồng hiện có; [implementation patterns](implementation-patterns.md) cung cấp ví dụ sử dụng contract, DI và transaction.

## 1. Pattern áp dụng

Ứng dụng giữ mô hình **modular monolith**, chia feature theo quyền sở hữu dữ liệu và hành vi. Mỗi feature dùng application service, port và infrastructure adapter; Nest module là nơi nối dependency.

| Pattern | Cách áp dụng |
|---|---|
| Application Service | Điều phối use case và kiểm tra điều kiện nghiệp vụ |
| Ports and Adapters | Application định nghĩa thao tác cần dùng; adapter triển khai bằng TypeORM hoặc dịch vụ ngoài |
| Repository | Truy vấn/ghi dữ liệu, trả model thuần; không nhận request hoặc trả ORM entity |
| Unit of Work | Application xác định nhóm thao tác cần nguyên tử; adapter thực thi transaction và bind repository |
| Dependency Injection | Interface đi kèm DI token; Nest module đăng ký implementation |
| Public module contract | Module khác chỉ dùng API được công bố, không truy cập repository nội bộ |

Không bổ sung CQRS bus, event bus, generic CRUD repository hoặc base service cho các use case hiện có. Không tạo facade chỉ để chuyển tiếp từng method; một service có thể trực tiếp triển khai public interface bằng `useExisting`.

## 2. Trách nhiệm từng thành phần

| Thành phần | Đảm nhiệm | Không đặt ở đây |
|---|---|---|
| Controller | Route, HTTP status, nhận principal/DTO, map input cho service và map response DTO | SQL, transaction, kiểm tra trạng thái dữ liệu, đọc header để suy luận payload |
| Pipe | Parse/validate param, query và body đã được parser đọc | Truy vấn database, kiểm tra phòng active, ghi hồ sơ |
| Middleware | Request ID, logging và thu nhận thông tin payload trước parser | Nghiệp vụ hoặc đồng bộ user |
| Guard | Xác thực và quyền truy cập route | Tạo user, truy vấn profile, điều phối use case |
| Interceptor | Chính sách HTTP cần request context, kiểm tra body rỗng và response envelope | Quyết định nghiệp vụ hoặc mở transaction |
| Application service | Invariant, thứ tự xử lý, phối hợp module và phạm vi transaction | DTO có decorator, `Principal`, HTTP exception, TypeORM, SQL |
| Application policy | Hàm thuần cho quy tắc nghiệp vụ được dùng lại hoặc cần kiểm thử độc lập | Request, DI container, truy vấn database |
| Port | Input/output và bảo đảm của thao tác mà application cần | `EntityManager`, ORM entity, HTTP status |
| Infrastructure adapter | SQL, row lock, entity mapping, cơ chế transaction và chuyển lỗi driver đã biết | Parse token, phân quyền route, tự chọn trạng thái nghiệp vụ |
| Nest module | Import module, đăng ký provider, bind token và export contract | Logic xử lý request hoặc nghiệp vụ |

`@Injectable()` và `@Inject()` được phép trong application để dùng Nest DI. Các API HTTP của Nest, `ConfigService`, Passport, Swagger và `class-validator` thuộc adapter hoặc composition root, không thuộc application.

Identity là adapter xác thực: sở hữu JWT/JWKS, claim mapping và role của route. Health là module vận hành: được probe DataSource để kiểm tra readiness. Hai module này không có quyền ghi dữ liệu feature hoặc tạo tiền lệ để service nghiệp vụ truy cập DataSource.

## 3. Folder và chiều phụ thuộc

```text
src/<feature>/
├── <feature>.module.ts
├── public/                        # Interface/token/model công khai cho module khác
├── application/
│   ├── <feature>.service.ts
│   ├── inputs/                    # Input thuần của use case
│   ├── models/                    # Model nội bộ, độc lập ORM/HTTP
│   ├── errors/                    # Lỗi application của feature
│   ├── policies/                  # Chỉ tạo khi có quy tắc cần tách
│   └── ports/                     # Repository và unit-of-work nội bộ
├── presentation/
│   ├── client/                    # Controller, request/response DTO của Client
│   └── admin/                     # Controller, request/response DTO của Admin
└── infrastructure/
    ├── <resource>.entity.ts
    ├── typeorm-<resource>.repository.ts
    ├── typeorm-<feature>-unit-of-work.ts
    └── public/                    # Factory tích hợp transaction được công bố
```

Chỉ tạo folder có nội dung. Kiểu trả cho module khác đặt tại `public/`; kiểu chỉ dùng nội bộ đặt tại `application/models/`. Controller/DTO không nằm ở root feature. Test giữ trong `test/`; migration giữ trong `src/database/migrations/`.

Các chiều import được phép:

```text
presentation → application → application/ports + public contract
infrastructure → application/ports + model + application error
feature.module → presentation + application + infrastructure
```

- Application không import `presentation/` hoặc `infrastructure/`, kể cả bằng `import type`.
- Module khác chỉ import `public/` và file Nest module của feature sở hữu dữ liệu. Interface công khai không chứa Nest/HTTP/ORM type hoặc decorator.
- Identity công bố kiểu thuần tại `public/principal.ts` và decorator HTTP tại `public/http/`. Chỉ presentation được dùng decorator HTTP; application không nhận `Principal` hoặc import các decorator này.
- Bookings dùng `UsersQueryApi` qua token công khai; không inject toàn bộ `UsersService` có cả quyền sync. Users service triển khai interface này, không cần một lớp facade chuyển tiếp.
- Ngoại lệ tích hợp duy nhất: infrastructure của Bookings được dùng `rooms/infrastructure/public/rooms-transaction.factory.ts` để bind cùng `EntityManager`. Factory được RoomsModule export; application vẫn chỉ thấy `RoomsBookingAccess`. Không import entity/repository Rooms từ Bookings.
- Không tạo vòng phụ thuộc module hoặc dùng `forwardRef()` để che vòng phụ thuộc.
- `common/application/` chứa error contract thuần; `common/validation/` chứa validator thuần dùng ở nhiều module; `common/http/` chứa thành phần HTTP dùng chung. `common` không import feature.
- Composition root được import feature để lắp ứng dụng; không chứa danh sách DTO hoặc hard-code mã lỗi nghiệp vụ để bù metadata thiếu ở feature.

Client/Admin có route, role metadata và DTO riêng; dùng chung application service và persistence. Không nhân đôi nghiệp vụ theo namespace HTTP.

## 4. Input, validation và danh tính

| Kiểm tra/chuyển đổi | Nơi thực hiện |
|---|---|
| UUID, độ dài chuỗi, ISO timestamp, field lạ | Request DTO và Pipe |
| Payload thực tế có rỗng hay không | `EmptyBodyInterceptor`, dùng thông tin body/raw payload từ HTTP adapter |
| Chữ ký, issuer/audience, token type, profile claim và role | Identity |
| `iat` là NumericDate hợp lệ | Một hàm thuần `isValidNumericDate` tại `common/validation/numeric-date.ts` |
| Sync bắt buộc có `issuedAt` hợp lệ | Users application, dùng lại validator trên |
| User đã được provision, phòng active, thời gian hợp lệ | Application service/policy |
| Token mới hơn watermark, lịch không chồng lấn | Contract application; adapter thực thi điều kiện nguyên tử và constraint tại database |

DTO request mô tả dữ liệu từ HTTP. Application nhận primitive hoặc `<UseCase>Input` thuần, không nhận DTO, request hoặc toàn bộ `Principal`. Controller lấy danh tính từ principal đã xác minh và map tường minh các field được phép. Input application của booking chứa `actorSub`, không nhận `userId` do client tự khai báo.

Controller chuyển timestamp đã validate thành `Date` khi tạo input booking. Application vẫn kiểm tra `Date` hợp lệ, thứ tự thời gian và thời điểm bắt đầu sau khi lấy khóa. HTTP validation không thay thế invariant; CLI/job gọi cùng service phải validate dữ liệu đầu vào của adapter tương ứng.

Identity dùng validator NumericDate để chuẩn hóa `issuedAt` thành số hợp lệ hoặc `undefined`. Users dùng cùng hàm để bảo vệ input sync từ mọi adapter; không sao chép lại biểu thức range check. GET hồ sơ không bắt buộc `iat`.

### Endpoint sync không nhận dữ liệu danh tính từ body

Không có body hoặc JSON object `{}` được chấp nhận. Object có field, array, scalar, `null` và payload không rỗng ngoài JSON bị từ chối với HTTP 400. Parser xử lý lỗi cú pháp, giới hạn và encoding trước interceptor; lỗi client giữ status 400/413/415 với message an toàn. Danh tính luôn lấy từ token.

- `EmptyBodyInterceptor` là thành phần HTTP dùng lại được; controller không nhận `@Body()`/`@Req()` chỉ để kiểm tra body rỗng.
- HTTP adapter phải cung cấp thông tin payload thực tế cho interceptor, kể cả content type không được JSON parser xử lý. Giới hạn body là 100 KiB, vượt giới hạn trả 413; không log payload. Dùng cùng giới hạn cho JSON parser và phần thu nhận payload của sync.
- Không kết luận body có dữ liệu chỉ vì có `Content-Length` hoặc `Transfer-Encoding`. Request chunked không chứa dữ liệu phải được chấp nhận như request rỗng thông thường.
- DTO rỗng hoặc Pipe chỉ nhìn parsed body không đủ để bảo vệ payload bị parser bỏ qua.
- Composition root chỉ đăng ký một pipeline parser và gắn CORS trước parser. Lỗi parse không được biến thành 500 hoặc làm mất CORS header của origin được phép.

## 5. Application, repository và transaction

Application sở hữu **ý nghĩa nghiệp vụ**; adapter sở hữu **cách bảo đảm trên database**. Tên method và contract port phải thể hiện kết quả, trường hợp không tìm thấy và bảo đảm khi gọi đồng thời.

| Thao tác | Application quyết định | Adapter thực hiện |
|---|---|---|
| Đọc user bắt buộc tồn tại | Ném `UserNotProvisionedError` khi repository trả `null` | SELECT, map row sang `User` |
| Sync profile | Kiểm tra input, gọi `upsertIfNewer` theo contract watermark | Upsert nguyên tử, giữ UUID, chỉ cập nhật khi phiên bản mới hơn |
| Deactivate room | Mở phạm vi UoW, kiểm tra phòng tồn tại, yêu cầu `isActive = false` | Khóa row, trả snapshot, cập nhật bằng manager được bind |
| Create booking | Lookup actor, kiểm tra phòng/thời gian trong UoW, chọn `status = confirmed` | Khóa phòng, insert và bảo vệ exclusion constraint |

Repository không ném lỗi “phòng không tồn tại” thay cho application khi kết quả lookup có thể biểu diễn bằng `null`. Repository không tự thêm `status = confirmed`; trạng thái được application truyền vào. Default/constraint trong schema tiếp tục là lớp bảo vệ dữ liệu.

### Quyền sở hữu transaction

- Use case có nhiều thao tác cần nguyên tử dùng port `<Feature>UnitOfWork.run(callback)`. Application đặt callback và thứ tự xử lý; adapter gọi `DataSource.transaction`, commit/rollback và map lỗi persistence.
- Repository trong callback chỉ dùng manager được bind, không tự mở transaction hoặc lấy repository từ DataSource singleton. Promise của mọi thao tác phải được `await` hoặc trả về từ callback; không chạy fire-and-forget.
- Một thao tác persistence nguyên tử như `upsertIfNewer` được phép mở transaction nội bộ để hoàn thành chính contract đó. Không tạo thêm UoW ở service chỉ để bọc một method nguyên tử.
- Không chuyển điều kiện watermark thành SELECT rồi so sánh/UPDATE tại service. Điều đó làm mất bảo đảm khi có request đồng thời.
- `READ COMMITTED` là isolation level của các luồng hiện tại. Sync giữ khóa conflict đến khi SELECT fallback xong; booking/deactivate cùng khóa row phòng. Không đổi isolation hoặc loại khóa như một thay đổi style code.
- Sau khi chờ khóa phòng, application phải kiểm tra lại active và thời gian bắt đầu. Exclusion constraint vẫn là bảo vệ cuối cho lịch trùng.
- Không gọi mạng, mở transaction độc lập hoặc gọi service dùng pool ngoài giữa callback rồi coi đó là cùng transaction.
- DataSource/pool chỉ được tạo trong DatabaseModule; lifecycle đóng pool khi shutdown. Migration CLI và script local chạy trong tiến trình riêng.
- Manager/repository được bind chỉ tồn tại trong callback. Không cache chúng trong singleton hoặc dùng sau khi transaction kết thúc.

Bootstrap local được seed Admin bằng SQL idempotent; đây là adapter tạo fixture local, không phải mẫu triển khai use case runtime. UUID/profile/watermark đã có phải được giữ khi chạy lại. Luồng cấp hồ sơ và contract retry giữ theo [user provisioning](user-provisioning.md).

## 6. Lỗi và logging

Application error gồm `code`, `kind`, message an toàn và `cause` tùy chọn; không chứa HTTP status. Mỗi feature định nghĩa lỗi ở `application/errors/`. Lỗi cần caller module khác xử lý được công bố qua `public/`; caller không deep-import lỗi nội bộ.

HTTP filter ánh xạ theo `kind`, không duy trì bảng mã lỗi riêng cho Users/Rooms/Bookings:

| `kind` | HTTP status |
|---|---|
| `invalid_input` | 400 |
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `unavailable` | 503 |

Ví dụ: `USER_NOT_PROVISIONED` có kind `conflict`; `INVALID_PROFILE_TOKEN` có kind `unauthenticated`; `ROOM_UNAVAILABLE` có kind `not_found`. HTTP status/error code của API hiện có được giữ nguyên. Filter vẫn xử lý HTTP exception từ guard/Pipe/parser; lỗi không dự kiến trả 500 với message chung.

- Adapter chỉ chuyển lỗi driver đã xác định được: exclusion violation phải khớp cả SQLSTATE và tên constraint. Lỗi SQL/lập trình khác tiếp tục là lỗi không dự kiến.
- Map lỗi transaction bên ngoài `await transaction(...)`; không nuốt lỗi rồi tiếp tục callback. Lỗi mất kết nối lúc commit có thể chưa xác định kết quả; không mô tả mọi lỗi là rollback thành công.
- Giữ `cause` phục vụ chẩn đoán nội bộ. Log dùng các field được cho phép: request ID, operation, error class, application code và SQLSTATE đã lọc. Không log nguyên driver error, query/parameters, request body, token hoặc password.
- Không `catch` chỉ để ném lại cùng lỗi, trả `null` khi database lỗi hoặc biến mọi lỗi thành 503.

## 7. Response và Swagger

- Controller trả response DTO; interceptor tạo envelope `{ data }` một lần. Health dùng raw response; HTTP 204 không có body.
- Application trả model thuần. Kết quả phân trang của application chỉ chứa items và metadata; presentation chuyển sang `PaginatedResponse` dành cho HTTP.
- Mapper response khai báo tường minh field được trả. Không spread ORM entity hoặc principal vào response.
- Mỗi controller công bố request/response và security bằng decorator. Decorator chung `ApiDataResponse(Model)` đăng ký model và envelope để tránh `$ref` dạng chuỗi và `extraModels` viết tay ở bootstrap.
- Cấu hình Swagger đặt trong `src/http/swagger.ts`. Chỉ cấu hình OAuth, URL và tạo document theo Client/Admin; không sửa security của từng operation sau khi sinh document.
- Client/Admin Swagger chỉ công bố route thuộc namespace tương ứng. Không coi việc lọc Swagger là cơ chế phân quyền API.

## 8. Style và naming

- TypeScript strict; không dùng `any`, `@ts-ignore`, `as unknown as` để vượt qua contract trong production code. Dữ liệu ngoài hệ thống bắt đầu bằng `unknown` và được narrow ở adapter.
- File dùng `kebab-case`; class/interface dùng `PascalCase`; biến/method dùng `camelCase`; DI token dùng `UPPER_SNAKE_CASE`.
- Dùng các hậu tố nhất quán: `RequestDto`, `ResponseDto`, `Input`, `RepositoryPort`, `UnitOfWork` và `Api` cho từng loại contract tương ứng.
- Tên thể hiện hành vi: `findBySub` trả `null`, `requireBySub` ném lỗi khi thiếu, `upsertIfNewer` có bảo đảm phiên bản. Không dùng `handle`, `process`, `utils` cho các hành vi đã biết rõ.
- Method public và port khai báo return type. Model/input chỉ chứa dữ liệu; không gắn decorator validation/Swagger/ORM.
- Định dạng: 2 spaces, single quote, semicolon, trailing comma; formatter dùng `printWidth: 100`. Không dồn class, method xử lý use case hoặc mảng provider vào một dòng.
- Luôn dùng braces cho `if`/`else` và đặt `throw`/`return` trên dòng riêng. Tách predicate có tên khi điều kiện chứa nhiều nhánh hoặc nhiều loại kiểm tra.
- Một hàm giữ cùng mức trừu tượng. Handler không xen thao tác header/parser với lời gọi use case. Không tách một biểu thức đơn giản thành nhiều lớp chỉ để giảm số dòng.
- Dùng `import type` cho kiểu; import value riêng cho token/class cần ở runtime. Giữ relative import hiện tại; không dùng barrel để che deep import trái quy tắc.
- Dùng lại quy tắc hoặc metadata thực sự trùng. Không gộp DTO Client/Admin chỉ vì hiện có cùng field; hai HTTP contract được phép phát triển riêng.
- Comment giải thích lý do về khóa, isolation hoặc constraint; không diễn đạt lại từng dòng code. Không ghi token/secret thật vào ví dụ hoặc fixture.

## 9. Kiểm tra tuân thủ

| Phạm vi | Kiểm chứng bắt buộc khi thay đổi phần đó |
|---|---|
| Style và dependency | Formatter, ESLint và kiểm tra import/exports theo ranh giới mục 3 |
| Application | Unit test invariant, nhánh lỗi và thứ tự thao tác; mock port thay vì mock EntityManager |
| HTTP | Test qua Nest pipeline: auth/role, DTO, status, response envelope và payload policy |
| Persistence | PostgreSQL integration test cho SQL, transaction, rollback, khóa và tranh chấp |
| Migration | Nâng cấp từ dữ liệu cũ, giữ UUID/FK và hành vi constraint |

Test sync phải có: không body, `{}`, field giả mạo, array/scalar/null, payload ngoài JSON và chunked rỗng. Các test đồng thời phải xác nhận cùng UUID và watermark mới nhất. Không dùng mock UoW làm bằng chứng transaction hoặc row lock hoạt động.

Khi sửa luồng deactivate, phải giữ kiểm thử cạnh tranh deactivate/booking. Khi sửa application error, test mapping mọi `kind` và giữ API error code. Không thêm test chỉ kiểm tra cấu trúc của implementation; không chạy integration database trên dữ liệu ứng dụng đang dùng.

`npm run lint` kiểm tra ESLint; `npm run format:check` kiểm tra Prettier; `npm run test:architecture` kiểm tra import, public contract, exports và vòng phụ thuộc giữa feature. Kiểm tra kiến trúc cũng chạy trong `npm test`. Lệnh build/test và yêu cầu Node nằm tại [README](../README.md#build-và-test).
