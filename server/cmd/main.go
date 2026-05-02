package main

import (
	"log"
	"net/http"
	"noteyard/server/internal/handler"
	"noteyard/server/internal/repository/sqlite"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	dbPath := dbFilePath()
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		log.Fatal(err)
	}

	db, err := sqlite.Open(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	uploadDir := uploadDirPath()
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatalf("create upload dir: %v", err)
	}

	pages := sqlite.NewPageRepo(db)
	blocks := sqlite.NewBlockRepo(db)
	databases := sqlite.NewDatabaseRepo(db)
	ph := handler.NewPageHandler(pages)
	bh := handler.NewBlockHandler(blocks)
	dh := handler.NewDatabaseHandler(databases)
	uh := handler.NewUploadHandler(uploadDir, "http://localhost:8080")

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:3000"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Content-Type"},
	}))

	// 静态图片文件服务
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir))))

	r.Route("/api", func(r chi.Router) {
		r.Post("/uploads", uh.Upload)
		r.Get("/meta", handler.MetaHandler)
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

	addr := ":8080"
	log.Printf("noteyard listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

func dbFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "noteyard.db"
	}
	return filepath.Join(home, ".local", "share", "noteyard", "noteyard.db")
}

func uploadDirPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "data/uploads"
	}
	return filepath.Join(home, ".local", "share", "noteyard", "uploads")
}
