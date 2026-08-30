.PHONY: dev-frontend test check

dev-frontend:
	npm run dev

# There is no test runner here. `npm run check` is tsc -b plus a production
# build, and it is the whole frontend gate.
check:
	npm run check

test: check
