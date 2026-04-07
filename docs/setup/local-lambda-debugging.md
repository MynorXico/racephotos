# Local Lambda debugging with SAM

Run any RaceShots Lambda locally in a Docker container that mirrors the real
Lambda execution environment (memory limits, timeout, `provided.al2023` runtime).
LocalStack handles DynamoDB, S3, and SQS — no AWS credentials or deployments
needed.

---

## How it works

SAM builds the Lambda binary, wraps it in a Docker container that matches the
Lambda runtime, and invokes it with a JSON event file you provide. The container
joins the same Docker network as LocalStack so it can reach DynamoDB and S3 at
`http://racephotos-localstack:4566`.

JWT validation is skipped entirely — the Lambda never validates tokens itself
(API Gateway does that in deployed environments). You just put whatever `sub`
value you want in the event file.

---

## Prerequisites

**1. SAM CLI**

```bash
pip install aws-sam-cli
# or on macOS: brew install aws/tap/aws-sam-cli
sam --version
```

**2. Docker** — must be running. SAM pulls a Lambda runtime image on first use.

**3. LocalStack running with resources seeded**

```bash
docker-compose up -d
make seed-local
```

---

## Invoking a Lambda

```bash
make invoke-get-photographer EVENT=get-existing
make invoke-get-photographer EVENT=get-not-found
make invoke-get-photographer EVENT=missing-auth

make invoke-update-photographer EVENT=update-valid
make invoke-update-photographer EVENT=update-invalid-currency
make invoke-update-photographer EVENT=update-empty-body
```

SAM builds the binary, starts the Lambda container, runs the invocation, and
streams structured JSON logs directly to your terminal. Each invoke does a fresh
build so your latest code is always what runs.

---

## Event files

Each Lambda has a `testdata/events/` directory with pre-built events for common
scenarios:

```
lambdas/get-photographer/testdata/events/
  get-existing.json          # happy path — sub must exist in DynamoDB
  get-not-found.json         # returns 404
  missing-auth.json          # returns 401 (no authorizer context)

lambdas/update-photographer/testdata/events/
  update-valid.json          # full valid upsert
  update-invalid-currency.json  # returns 400 — unsupported currency code
  update-empty-body.json     # returns 400 — empty body
```

To test a specific scenario not covered, copy the closest event file and edit
the `sub` claim or `body` field. The `sub` value is just a string — use any
photographer ID that exists (or doesn't exist) in LocalStack.

---

## Seeding a test photographer

The `get-existing` event uses `sub: test-photographer-001`. Seed it into
LocalStack before invoking:

```bash
awslocal dynamodb put-item \
  --table-name racephotos-photographers \
  --item '{
    "id":          {"S": "test-photographer-001"},
    "displayName": {"S": "Test Photographer"},
    "defaultCurrency": {"S": "USD"},
    "createdAt":   {"S": "2026-01-01T00:00:00Z"},
    "updatedAt":   {"S": "2026-01-01T00:00:00Z"}
  }'
```

---

## Timeout and memory

| Setting | Local (SAM) | Deployed (CDK)       |
| ------- | ----------- | -------------------- |
| Memory  | 256 MB      | 256 MB               |
| Timeout | 30 s        | 3 s (Lambda default) |

The local timeout is extended to 30 s so LocalStack latency does not cause
spurious failures during debugging. To test timeout behaviour specifically,
edit `template.yaml` and lower `Timeout` to `3`.

---

## Adding a new Lambda

When a new Lambda is added to the project:

**1. Add the function to `template.yaml`**:

```yaml
SearchFunction:
  Type: AWS::Serverless::Function
  Metadata:
    BuildMethod: makefile
  Properties:
    FunctionName: racephotos-search-local
    Handler: bootstrap
    CodeUri: lambdas/search/
    Environment:
      Variables:
        RACEPHOTOS_PHOTOS_TABLE: racephotos-photos
        RACEPHOTOS_BIB_INDEX_TABLE: racephotos-bib-index
```

**2. Add event files** in `lambdas/<name>/testdata/events/` — one JSON file per
scenario you want to be able to invoke quickly.

**3. Add a Makefile target** in the root `Makefile`:

```makefile
invoke-search:
	cd lambdas/search && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bootstrap .
	sam local invoke SearchFunction \
	  -t template.yaml \
	  -e lambdas/search/testdata/events/$(EVENT).json \
	  --docker-network $(DOCKER_NETWORK)
```

And add `invoke-search` to the `.PHONY` line at the top.

---

## Troubleshooting

**`Error: Cannot connect to the Docker daemon`**
Docker is not running. Start Docker Desktop or the Docker daemon.

**`ConnectionRefused` / `dial tcp ... connection refused` in Lambda logs**
The Lambda container cannot reach LocalStack. Check that:

- LocalStack is running: `docker ps | grep racephotos-localstack`
- The Docker network exists: `docker network ls | grep racephotos_default`
- You are passing `--docker-network racephotos_default` (the Makefile does this
  automatically; override with `DOCKER_NETWORK=yournet make invoke-...`)

**First invoke is slow**
SAM pulls the `public.ecr.aws/lambda/provided:al2023` image on first use.
Subsequent invokes reuse the cached image and are much faster.
