.PHONY: dev build server web install

install:
	cd web && npm install

dev: install
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
