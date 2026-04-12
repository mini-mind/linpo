.DEFAULT_GOAL := help

PYTHON := $(shell if [ -x .venv/bin/python ]; then printf '%s' .venv/bin/python; else printf '%s' python; fi)

.PHONY: help python-test python-typecheck frontend-build quality

help:
	@printf '%s\n' \
		'help              Show available targets' \
		'python-test       Run Python tests' \
		'python-typecheck  Run Python type checks' \
		'frontend-build    Build the frontend' \
		'quality           Run all quality checks'

python-test:
	$(PYTHON) -m pytest

python-typecheck:
	$(PYTHON) -m basedpyright

frontend-build:
	npm --prefix frontend run build

quality:
	@$(MAKE) python-test
	@$(MAKE) python-typecheck
	@$(MAKE) frontend-build
