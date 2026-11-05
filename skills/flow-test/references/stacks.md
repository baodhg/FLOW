# Lệnh test theo stack

Lệnh của repo thắng bảng này. Đọc `verify` trong `.flow/profile.json` trước.

Mục lục: .NET · Node · Go · Python · Java/Kotlin · DB thật dùng một lần

## .NET

```
dotnet test --filter "FullyQualifiedName~LoanServiceTests.RejectsSecondRenewal"
dotnet test --list-tests
```

DB thật: gói `Testcontainers` cho .NET với image của engine đang dùng. EF Core InMemory không kiểm được ràng buộc và transaction.

## Node

```
npx vitest run src/loan/renew.test.ts -t "rejects second renewal"
npx vitest list
npx jest src/loan/renew.test.ts -t "rejects second renewal"
npx jest --listTests
node --test --test-name-pattern="rejects second renewal"
```

`jest --listTests` chỉ liệt kê tệp. Đếm ca bằng tổng ở cuối lần chạy hoặc `--json`.

DB thật: `testcontainers` cho Node. Prisma hay TypeORM thì áp migration thật vào container, không dựng schema bằng `sync`.

## Go

```
go test ./internal/loan -run '^TestRejectsSecondRenewal$' -count=1
go test ./internal/loan -list '.*'
go test -race ./internal/loan
```

`-count=1` tắt bộ đệm kết quả, nếu không thì `ok (cached)` không nói gì về mã hiện tại.

DB thật: `testcontainers-go`, hoặc dựng schema mới theo từng test với migration thật.

## Python

```
pytest tests/test_loan.py::test_rejects_second_renewal -q
pytest --collect-only -q
```

DB thật: `testcontainers` cho Python, hoặc `pytest-postgresql`. Django dùng test database của framework trên đúng engine production, không dùng SQLite thay thế.

## Java/Kotlin

```
./gradlew test --tests 'library.LoanServiceTest.rejectsSecondRenewal'
mvn -Dtest='LoanServiceTest#rejectsSecondRenewal' test
```

Đếm: đọc XML báo cáo ở `build/test-results/test/` với Gradle hoặc `target/surefire-reports/` với Maven. Gradle có thể báo `UP-TO-DATE`; thêm `--rerun-tasks` hoặc `cleanTest` khi cần chạy thật.

DB thật: Testcontainers cho JVM. H2 ở chế độ tương thích không thay được engine thật.

## DB thật dùng một lần

Mọi stack đều theo cùng các điều sau:

- Mỗi lần chạy một CSDL mới, xoá khi xong.
- Áp migration thật, để test cả migration.
- Cổng ngẫu nhiên, để chạy song song không đụng nhau.
- Không trỏ test vào CSDL dùng chung của người khác.
