# CLAUDE.md — update-photographer

## Service identity

- **Lambda name**: `update-photographer`
- **HTTP method + route**: `PUT /photographer/me`
- **Auth**: Cognito JWT required
- **Story**: RS-004 — Photographer account — auth shell + profile setup

## Environment variables

```
RACEPHOTOS_ENV                 required — "local"|"dev"|"qa"|"staging"|"prod"
RACEPHOTOS_PHOTOGRAPHERS_TABLE required — DynamoDB table name (e.g. racephotos-photographers)
```

## Interfaces

```go
// PhotographerUpserter — DynamoDB photographers table (read + write)
type PhotographerUpserter interface {
    GetPhotographer(ctx context.Context, id string) (*models.Photographer, error)
    UpsertPhotographer(ctx context.Context, p models.Photographer) error
}
```

## DynamoDB access patterns

| Operation | Table                      | Key / Index | Condition             |
| --------- | -------------------------- | ----------- | --------------------- |
| GetItem   | `racephotos-photographers` | PK=`id`     | to preserve CreatedAt |
| PutItem   | `racephotos-photographers` | PK=`id`     | full replace (upsert) |

## Error handling

| Condition             | Error                     | HTTP status |
| --------------------- | ------------------------- | ----------- |
| Missing JWT sub claim | —                         | 401         |
| Malformed JSON body   | —                         | 400         |
| Invalid currency code | `apperrors.ErrValidation` | 400         |
| DynamoDB error        | —                         | 500         |

## What Claude must not do in this Lambda

- Call `os.Getenv` outside `main.go`
- Return raw AWS SDK errors to API Gateway callers
- Use `context.Background()` inside the handler or anything it calls
- Log `BankAccountNumber`, `BankAccountHolder`, or `BankInstructions` fields
