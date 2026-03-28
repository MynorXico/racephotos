.PHONY: test test-unit test-integration lint lint-check build seed-local synth ng-build ng-test e2e validate

LAMBDAS := photo-upload photo-processor watermark search payment

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
	@if [ -d shared ]; then \
		echo "==> unit tests: shared"; \
		cd shared && go test ./... -count=1 && cd ..; \
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
	@if [ -d shared ]; then \
		echo "==> lint: shared"; \
		cd shared && go vet ./... && golangci-lint run ./... && cd ..; \
	fi

# Non-zero exit on any lint issue (used by hooks)
lint-check: lint

# Seed LocalStack with resources matching CDK definitions
seed-local:
	@echo "Starting LocalStack seed..."
	bash scripts/seed-local.sh

# CDK synth check
synth:
	cd infra/cdk && npx cdk synth

# Angular build check
ng-build:
	cd frontend/angular && ng build --configuration=production

# Angular unit tests
ng-test:
	cd frontend/angular && ng test --watch=false --code-coverage

# Storybook build (component isolation check)
storybook-build:
	cd frontend/angular && npm run storybook:build

# Playwright E2E tests (requires dev server running)
e2e:
	cd frontend/angular && npx playwright test

# Full validation — runs everything
validate: test lint synth ng-build ng-test storybook-build
