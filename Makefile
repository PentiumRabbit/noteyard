.PHONY: dev build server web install stop sidecar

install:
	cd web && npm install

stop:
	@lsof -ti :8080 | xargs kill -9 2>/dev/null || true
	@for port in 5173 5174 5175 5176 5177; do lsof -ti :$$port | xargs kill -9 2>/dev/null || true; done

dev: stop install
	cd web && npx tauri dev

server-dev:
	cd server && go run ./cmd/main.go

web-dev:
	cd web && npm run dev

build: build-web build-server

build-web:
	cd web && npm run build

build-server: build-web
	cd server && go build -o ../bin/noteyard ./cmd/main.go

sidecar:
	bash scripts/build-sidecar.sh

clean:
	rm -rf bin/ web/dist/
