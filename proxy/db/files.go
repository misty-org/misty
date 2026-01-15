package db

import (
	"database/sql"
	"errors"
	"log"

	minidfs "github.com/kannachi323/misty/proxy/proto_src"
)

// InsertFile tracks the initial metadata for a new file
func (db *Database) InsertFile(f *minidfs.FileInfo) error {
	_, err := db.Conn.Exec(`
		INSERT INTO files (file_path, hash, size, mtime, is_dir) 
		VALUES (?, ?, ?, ?, ?)`,
		f.FilePath, f.Hash, f.Size, f.Mtime, f.IsDir,
	)
	if err != nil {
		log.Println("Failed to insert file metadata:", err)
	}
	return err
}

// GetFile retrieves metadata to check if local files are out of date
func (db *Database) GetFile(path string) (*minidfs.FileInfo, error) {
	f := &minidfs.FileInfo{}

	log.Println(path)
	
	err := db.Conn.QueryRow(`
		SELECT file_path, hash, size, mtime, is_dir
		FROM files WHERE file_path = ?`, 
		path,
	).Scan(&f.FilePath, &f.Hash, &f.Size, &f.Mtime, &f.IsDir)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
            return nil, nil
        }
		log.Println(err)
		return nil, err
	}

	return f, nil
}