# CLAUDE.md — get-photographer

## Service identity

- **Lambda name**: `get-photographer`
- **HTTP method + route**: `GET /photographer/me`
- **Auth**: Cognito JWT required
- **Story**: RS-004 — Photographer account — auth shell + profile setup

## Environment variables

```
RACEPHOTOS_ENV                 required — "local"|"dev"|"qa"|"staging"|"prod"
RACEPHOTOS_PHOTOGRAPHERS_TABLE required — DynamoDB table name (e.g. racephotos-photographers)
```

## Interfaces

```go
// PhotographerGetter — DynamoDB photographers table (read-only)
type PhotographerGetter interface {
    GetPhotographer(ctx context.Context, id string) (*models.Photographer, error)
}
```

## DynamoDB access patterns

| Operation | Table                      | Key / Index | Condition |
| --------- | -------------------------- | ----------- | --------- |
| GetItem   | `racephotos-photographers` | PK=`id`     | —         |

## Error handling

| Condition             | Error                   | HTTP status |
| --------------------- | ----------------------- | ----------- |
| Missing JWT sub claim | —                       | 401         |
| Record not found      | `apperrors.ErrNotFound` | 404         |
| DynamoDB error        | —                       | 500         |

## What Claude must not do in this Lambda

- Call `os.Getenv` outside `main.go`
- Return raw AWS SDK errors to API Gateway callers
- Use `context.Background()` inside the handler or anything it calls
- Log `BankAccountNumber`, `BankAccountHolder`, or `BankInstructions` fields
