package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/kannachi323/misty/proxy/db"
	minidfs "github.com/kannachi323/misty/proxy/proto_src"
	"google.golang.org/protobuf/encoding/protojson"
)

func CreateFile(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusInternalServerError)
			return
		}
		defer r.Body.Close()

		fileInfo := &minidfs.FileInfo{}
		err = protojson.Unmarshal(body, fileInfo)
		if err != nil {
			http.Error(w, "Invalid JSON format", http.StatusBadRequest)
			return
		}

		err = db.InsertFile(fileInfo)
		if err != nil {
			http.Error(w, "something went wrong with creating the file", http.StatusInternalServerError)
		}
	
		w.WriteHeader(http.StatusOK)
	}
}


func GetFile(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		filePath := r.URL.Query().Get("file_path")
		if filePath == "" {
			http.Error(w, "file_path parameter is required", http.StatusBadRequest)
			return
		}

		fileInfo, err := db.GetFile(filePath)
		if err != nil {
			http.Error(w, "something went wrong with getting file", http.StatusInternalServerError)
		}
	
		w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(fileInfo)
	}
}