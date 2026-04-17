I. Core Single-Client Logic (The Basics)
Store Empty File: Verify storing a 0-byte file works and doesn't crash the loop.

Store Exact Chunk Size: Store a file exactly equal to your buffer size (e.g., 64KB). Tests "off-by-one" errors in loops.

Store File > RAM: Store a file larger than available RAM (if feasible) or just significantly large to ensure streaming works.

Fetch Non-Existent File: Verify server returns NOT_FOUND (you have this, keep it).

Fetch Empty File: Verify fetching a 0-byte file returns an empty stream, not an error.

Delete Locked File: Try to delete a file that is currently being read/written by yourself (edge case).

Overwrite Existing File: Store "A.txt", then Store "A.txt" again with different content. Verify the new content is correct.

Directory Creation: Store subdir/deep/nested/file.txt. Verify server creates the folder structure automatically.

II. Concurrency & Locking (Multi-Client)
Read-While-Write: Client A writes big_file.bin. Client B tries to read big_file.bin before A finishes. Expect: Block or Error (depending on design).

Write-While-Write: Client A and B try to write to same.txt at the exact same time. Expect: One succeeds, one fails (Locked).

Delete-While-Read: Client A is reading doc.pdf. Client B deletes doc.pdf. Expect: A's stream might fail or finish (depending on OS file locking).

Lock Timeout: Client A acquires a lock but crashes (never calls release). Verify Client B can eventually acquire the lock (requires implementing timeouts).

PubSub Notification: Client A subscribes. Client B uploads. Verify Client A gets the CREATED event.

PubSub Multiple Subscribers: Clients A, B, and C subscribe. Client D uploads. Verify A, B, and C all get the event.

III. Network & Resilience (The "Chaos" Tests)
Client Disconnect Mid-Upload: Start uploading a 1GB file, kill the client process halfway. Verify server deletes the partial temp file (cleanup).

Server Restart: Kill server, restart it. Verify client can reconnect and stored files are still there (persistence).

Corrupt Stream: Manually send a FileBuffer with a checksum mismatch (if implemented). Verify server rejects it.

Slow Loris Upload: Client sends 1 byte every 10 seconds. Verify server doesn't hang forever (requires timeout config).

IV. Security & Validation
Path Traversal Attack: Client tries to store file at ../../etc/passwd. Verify server rejects paths outside the mount point.

Invalid Filenames: Try storing files with illegal characters (*, ?, :, \0).

Huge Filename: Try storing a file with a name longer than 255 chars (OS limit).

V. Performance (Benchmarks)
Throughput Test: Measure MB/s for 1GB file upload vs. local copy.

Small File Storm: specific test uploading 10,000 tiny (1KB) files rapidly. Checks handle/inode exhaustion.


Expired Token: Client sends a valid but expired Firebase JWT. Server must reject.

Wrong User: Client A tries to FetchFile belonging to Client B. Server must return PERMISSION_DENIED.

No Token: Client tries to call StoreFile without any metadata. Server must reject.

Database Sync: If a file is deleted via gRPC, is the metadata also removed from Firebase/Firestore?

JWT Injection: Manually call StoreFile from a script without a JWT. Verify the server rejects it.

Expired Token Rejection: Use a hardcoded expired token and verify the server doesn't allow the upload.

Tauri Sidecar Lifecycle: Test that closing the Tauri window correctly kills the C++ sidecar process (prevents "zombie" servers).


UI Progress Bar Sync: Upload a 50MB file; verify the FileBuffer offset matches the progress bar shown in the UI.

Multi-Tab Conflict: Open two Tauri windows. Log into different Firebase accounts. Verify they can't access each other's private DFS folders.

Chunk Reordering: What if gRPC chunks arrive out of order? (gRPC guarantees order, but your offset logic should still validate this) .


Disk Full Error: Manually fill your server's drive. Verify WriteFile returns DATA_LOSS and the UI shows an "Out of Space" error instead of crashing.


Lock Recovery: Acquire a lock via GetFileLock, crash the client, restart. Can you still write to that file?.

File Path Sanitization: Try to upload a file named ../../../system32/config. Verify your FileManager::ResolvePath prevents it from leaving the server_mount.

Large File Fetch Interruption: Start a FetchFile stream, disconnect the network, reconnect. Does the UI handle the stream break gracefully?.
