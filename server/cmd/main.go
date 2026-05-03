package main

import (
	"log"
	"net/http"
	"noteyard/server/internal/backup"
	"noteyard/server/internal/config"
	"noteyard/server/internal/handler"
	"noteyard/server/internal/repository/sqlite"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// Load application configuration from ~/.config/noteyard/config.toml.
	cfg := config.Load()

	// Ensure data directory and backups subdirectory exist.
	if err := os.MkdirAll(filepath.Join(cfg.Data.Dir, "backups"), 0755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	dbPath := filepath.Join(cfg.Data.Dir, "noteyard.db")

	db, err := sqlite.Open(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	uploadDir := uploadDirPath(cfg)
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatalf("create upload dir: %v", err)
	}

	// Set up backup manager.
	backupMgr := backup.NewManager(
		dbPath,
		func() string { return filepath.Join(cfg.Data.Dir, "backups") },
		func() int { return cfg.Backup.OpsThreshold },
		func() int { return cfg.Backup.MaxBackups },
	)

	// Register OS signal handler for graceful-exit backup.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("[main] shutting down, running exit backup...")
		backupMgr.OnExit()
		os.Exit(0)
	}()

	pages := sqlite.NewPageRepo(db)
	blocks := sqlite.NewBlockRepo(db)
	databases := sqlite.NewDatabaseRepo(db)
	ph := handler.NewPageHandler(pages)
	bh := handler.NewBlockHandler(blocks)
	dh := handler.NewDatabaseHandler(databases)
	sh := handler.NewSearchHandler(db)
	uh := handler.NewUploadHandler(uploadDir, "http://localhost:8080")
	cuh := handler.NewCleanupHandler(uploadDir, db)
	ch := handler.NewConfigHandler(cfg, func(newDir string) error {
		return config.MigrateDataDir(cfg, newDir)
	})

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:3000"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Content-Type"},
	}))

	// Count write operations for backup triggering.
	r.Use(writeCountMiddleware(backupMgr))

	// Static image file server.
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir))))

	r.Route("/api", func(r chi.Router) {
		r.Post("/uploads", uh.Upload)
		r.Post("/uploads/cleanup", cuh.CleanupOrphanUploads)
		r.Get("/meta", handler.MetaHandler)
		r.Get("/config", ch.Get)
		r.Put("/config", ch.Update)
		r.Get("/search", sh.Handle)
		r.Route("/pages", func(r chi.Router) {
			r.Get("/", ph.ListAll)
			r.Post("/", ph.Create)
			r.Get("/trash", ph.ListTrashed)
			r.Get("/search", ph.Search)
			r.Get("/{id}", ph.Get)
			r.Put("/{id}", ph.Update)
			r.Delete("/{id}", ph.Delete)
			r.Post("/{id}/restore", ph.Restore)
			r.Delete("/{id}/permanent", ph.PermanentDelete)
			r.Get("/{id}/blocks", bh.ListByPage)
			r.Post("/{id}/blocks", bh.Create)
			r.Get("/{id}/ancestors", ph.GetAncestors)
			r.Get("/{id}/backlinks", ph.Backlinks)
		})
		r.Route("/blocks", func(r chi.Router) {
			r.Put("/{id}", bh.Update)
			r.Delete("/{id}", bh.Delete)
			r.Patch("/batch", bh.BatchUpdate)
		})
		r.Route("/databases", func(r chi.Router) {
			r.Post("/", dh.Create)
			r.Get("/{id}", dh.Get)
			r.Patch("/{id}", dh.UpdateTitle)
			r.Delete("/{id}", dh.Delete)
			r.Post("/{id}/columns", dh.AddColumn)
			r.Put("/{id}/columns/{col_id}", dh.UpdateColumn)
			r.Delete("/{id}/columns/{col_id}", dh.DeleteColumn)
			r.Post("/{id}/rows", dh.AddRow)
			r.Delete("/{id}/rows/{row_id}", dh.DeleteRow)
			r.Get("/{id}/rows", dh.ListRows)
			r.Get("/{id}/rows/{row_id}", dh.GetRow)
			r.Patch("/{id}/rows/{row_id}", dh.PatchRow)
			r.Patch("/{id}/rows/{row_id}/cells", dh.BatchUpdateCells)
		})
	})

	addr := "127.0.0.1:8080"
	log.Printf("noteyard listening on http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

// uploadDirPath returns the upload directory derived from the config.
func uploadDirPath(cfg *config.Config) string {
	return filepath.Join(cfg.Data.Dir, "uploads")
}

// writeCountMiddleware counts mutating HTTP requests (POST/PUT/PATCH/DELETE)
// and notifies the backup manager.
func writeCountMiddleware(mgr *backup.Manager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				mgr.RecordWrite()
			}
		})
	}
}
