.PHONY: dev build server web install stop

install:
	cd web && npm install

stop:
	@lsof -ti :8080 | xargs kill -9 2>/dev/null || true
	@lsof -ti :5173,:5174,:5175,:5176,:5177 | xargs kill -9 2>/dev/null || true

dev: stop install
	$(MAKE) -j2 server-dev web-dev

server-dev:
	cd server && go run ./cmd/main.go

web-dev:
	cd web && npm run dev

build: build-web build-server

build-web:
	cd web && npm run build

build-server: build-web
	cd server && go build -o ../bin/noteyard ./cmd/main.go

clean:
	rm -rf bin/ web/dist/
