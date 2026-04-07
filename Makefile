.PHONY: test test-unit test-integration lint lint-check build seed-local synth cdk-check ng-build ng-lint ng-test storybook-build e2e validate format

LAMBDAS := photo-upload photo-processor watermark search payment get-photographer update-photographer create-event get-event update-event archive-event list-photographer-events

# Run all tests
test: test-unit test-integration

# Unit tests — no AWS, no LocalStack required
test-unit:
	@for lambda in $(LAMBDAS); do \
		if [ -d lambdas/$$lambda ]; then \
			echo "==> unit tests: $$lambda"; \
			cd lambdas/$$lambda && go test ./... -count=1 && cd ../..; \
		fi \
	done
	@if [ -d lambdas/shared ]; then \
		echo "==> unit tests: shared"; \
		cd lambdas/shared && go test ./... -count=1 && cd ../..; \
	fi

# Integration tests — requires LocalStack running (docker-compose up -d)
test-integration:
	@for lambda in $(LAMBDAS); do \
		if [ -d lambdas/$$lambda/test/integration ]; then \
			echo "==> integration tests: $$lambda"; \
			cd lambdas/$$lambda && go test -tags=integration ./test/integration/... -count=1 && cd ../..; \
		fi \
	done

# Build all Lambda binaries (linux/amd64 for Lambda runtime)
build:
	@for lambda in $(LAMBDAS); do \
		if [ -d lambdas/$$lambda ]; then \
			echo "==> build: $$lambda"; \
			cd lambdas/$$lambda && GOOS=linux GOARCH=amd64 go build -o bootstrap . && cd ../..; \
		fi \
	done

# Run linters (requires golangci-lint on PATH — see docs/setup/tooling.md)
lint:
	@for lambda in $(LAMBDAS); do \
		if [ -d lambdas/$$lambda ]; then \
			echo "==> lint: $$lambda"; \
			cd lambdas/$$lambda && go vet ./... && golangci-lint run ./... && cd ../..; \
		fi \
	done
	@if [ -d lambdas/shared ]; then \
		echo "==> lint: shared"; \
		cd lambdas/shared && go vet ./... && golangci-lint run ./... && cd ../..; \
	fi

# Non-zero exit on any lint issue (used by hooks)
lint-check: lint

# Seed LocalStack with resources matching CDK definitions
seed-local:
	@echo "Starting LocalStack seed..."
	bash scripts/seed-local.sh

# CDK synth — requires real AWS credentials and resolved SSM context.
# Run locally before deploying. Not used in CI (see cdk-check).
synth:
	cd infra/cdk && npx cdk synth

# CDK type-check + unit tests — no AWS credentials required, safe in CI
cdk-check:
	cd infra/cdk && npx tsc --noEmit && npm test

# Angular build check
ng-build:
	cd frontend/angular && npx ng build --configuration=production

# Angular ESLint
ng-lint:
	cd frontend/angular && npm run lint

# Angular unit tests
ng-test:
	cd frontend/angular && npx ng test --watch=false --code-coverage

# Storybook build (component isolation check)
storybook-build:
	cd frontend/angular && npm run storybook:build

# Playwright E2E tests (requires dev server running)
e2e:
	cd frontend/angular && npx playwright test

# Format all files with Prettier (root + Angular)
format:
	npx prettier --write "**/*.{ts,html,scss,json,yml,yaml,md}" --ignore-path .prettierignore

# Full validation — runs everything (cdk-check, not synth — synth needs credentials)
validate: test lint cdk-check ng-build ng-lint ng-test storybook-build
