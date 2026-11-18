.DEFAULT_GOAL := help

# Use the Windows npm launcher with the MSYS2 and Cygwin builds of Make.
ifneq (,$(filter %-msys %-cygwin,$(MAKE_HOST)))
SHELL := cmd.exe
.SHELLFLAGS := /d /c
export MSYS2_ARG_CONV_EXCL := /d;/c
endif

.PHONY: help install dev lint typecheck test check install-browser test-e2e build preview

define commands
make install          Install dependencies from the lockfile
make dev              Start the development server
make lint             Run ESLint
make typecheck        Check TypeScript
make test             Run the data tests
make check            Run lint, typecheck, and data tests
make install-browser  Install Chromium for Playwright
make test-e2e         Build and run the browser tests
make build            Build the static site into dist/
make preview          Build and serve the static site locally
endef

help:
	@$(info $(commands))

install:
	npm ci

dev:
	npm run dev

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm test

check: lint typecheck test

install-browser:
	npx playwright install chromium

test-e2e:
	npm run test:e2e

build:
	npm run build

preview: build
	npm run preview
