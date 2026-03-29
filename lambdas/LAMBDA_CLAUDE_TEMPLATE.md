# CLAUDE.md — <lambda-name>

> **How to use this template**: Copy this file to `lambdas/<your-lambda>/CLAUDE.md`,
> fill in every `<placeholder>`, and delete this header block. The resulting file
> is the single source of truth Claude Code uses when building this Lambda. Rules
> here override the root CLAUDE.md for this service only.

---

## Service identity

- **Lambda name**: `<lambda-name>` (matches the directory under `lambdas/`)
- **HTTP method + route**: e.g. `POST /events` or `GET /download/{token}`
- **Auth**: Cognito JWT required | no auth (public)
- **Story**: RS-NNN — <story title>

---

## Environment variables

List every env var this Lambda reads from `os.Getenv`. These must be declared in
`main.go` and injected by the CDK construct. No other file may call `os.Getenv`.

```
RACEPHOTOS_ENV                  required — "local"|"dev"|"qa"|"staging"|"prod"
RACEPHOTOS_<VAR_NAME>           required — <description>
RACEPHOTOS_<OPTIONAL_VAR>       optional — <description> (default: <value>)
```

---

## Interfaces

List every interface this Lambda depends on. Implementations live in `main.go`
(wired at init time). All business logic receives interfaces, never concrete types.

```go
// <InterfaceName> — <what it abstracts (e.g. "DynamoDB photos table")>
type <InterfaceName> interface {
    <MethodName>(ctx context.Context, <params>) (<returns>, error)
}
```

Add one block per interface. Do not list standard library types (e.g. `http.Client`).

---

## DynamoDB access patterns

Describe every DynamoDB call this Lambda makes. Be specific — Claude uses this to
generate the correct `expression.Builder` calls and GSI query shapes.

| Operation  | Table                | Key / Index                     | Condition                    |
| ---------- | -------------------- | ------------------------------- | ---------------------------- |
| GetItem    | `racephotos-<table>` | PK=`id`                         | —                            |
| Query      | `racephotos-<table>` | GSI `<index-name>` PK=`<field>` | filter: `status = "pending"` |
| PutItem    | `racephotos-<table>` | PK=`id`                         | —                            |
| UpdateItem | `racephotos-<table>` | PK=`id`                         | SET `<field>` = `:val`       |

---

## Error handling

Map business errors to HTTP status codes. Add a row for every non-200 case.

| Condition                    | Error                     | HTTP status |
| ---------------------------- | ------------------------- | ----------- |
| Record not found             | `apperrors.ErrNotFound`   | 404         |
| Caller does not own resource | `apperrors.ErrForbidden`  | 403         |
| Validation failure           | `apperrors.ErrValidation` | 400         |
| <domain-specific case>       | `apperrors.Err<Name>`     | <code>      |

---

## Test patterns

### Unit tests (`<name>_test.go`)

- Table-driven tests using `testify/assert` and `testify/require`
- Mock every interface with `gomock` — generated mocks go in `mocks/`
- Cover the happy path and every error row in the error-handling table above
- Do **not** call `os.Getenv` or construct real AWS clients in unit tests

```go
// Example table structure
tests := []struct {
    name    string
    input   <InputType>
    mockFn  func(*MockStore)
    want    <OutputType>
    wantErr string
}{
    {
        name:  "happy path — <description>",
        input: <InputType>{<fields>},
        mockFn: func(m *MockStore) {
            m.EXPECT().<Method>(...).Return(<value>, nil)
        },
        want: <OutputType>{<fields>},
    },
    {
        name:    "not found — returns 404",
        input:   <InputType>{<fields>},
        mockFn:  func(m *MockStore) {
            m.EXPECT().<Method>(...).Return(nil, apperrors.ErrNotFound)
        },
        wantErr: "not found",
    },
}
```

### Integration tests (`test/integration/integration_test.go`)

- Build tag: `//go:build integration`
- Target: LocalStack (never real AWS)
- Seed required DynamoDB records before each test; clean up after
- Use `AWS_ENDPOINT_URL=http://localhost:4566` from env

---

## Local development notes

- When `RACEPHOTOS_ENV=local`: wire the file-backed Rekognition mock if this
  Lambda uses Rekognition (reads from `testdata/rekognition-responses/`)
- Run this Lambda's unit tests: `cd lambdas/<name> && go test ./...`
- Run integration tests: `cd lambdas/<name> && go test -tags=integration ./test/integration/`

---

## What Claude must not do in this Lambda

- Call `os.Getenv` outside `main.go`
- Return raw AWS SDK errors to API Gateway callers
- Use `context.Background()` inside the handler or anything it calls
- Log runner email addresses, presigned URLs, or payment references
- Hardcode table names, bucket names, or queue URLs
