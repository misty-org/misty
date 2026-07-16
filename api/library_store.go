package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

var (
	ErrLibraryObjectNotFound = errors.New("library object not found")
	libraryObjectKeyPattern  = regexp.MustCompile(`^library/[a-zA-Z0-9_-]{8,160}$`)
)

const librarySHA256MetadataKey = "misty-library-sha256"

type LibraryObjectMetadata struct {
	ByteSize int64
	SHA256   string
	MIMEType string
}

// LibraryObjectStore is deliberately separate from the short-lived Agent
// attachment store. Implementations must point at a private, permanent bucket.
type LibraryObjectStore interface {
	Put(context.Context, string, io.Reader, LibraryObjectMetadata) error
	Head(context.Context, string) (LibraryObjectMetadata, error)
	Open(context.Context, string) (io.ReadCloser, LibraryObjectMetadata, error)
	Delete(context.Context, string) error
}

type memoryLibraryObject struct {
	data     []byte
	metadata LibraryObjectMetadata
}

type MemoryLibraryObjectStore struct {
	mu      sync.RWMutex
	objects map[string]memoryLibraryObject
}

// LocalLibraryObjectStore is a persistent development backend. Production
// rejects it so deployed Library data must use the separately configured R2/S3
// bucket, while desktop development survives server restarts.
type LocalLibraryObjectStore struct{ root string }

func NewLocalLibraryObjectStore(root string) (*LocalLibraryObjectStore, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("local Library directory is required")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(absolute, 0o700); err != nil {
		return nil, err
	}
	return &LocalLibraryObjectStore{root: absolute}, nil
}

func (s *LocalLibraryObjectStore) paths(key string) (string, string, error) {
	if !libraryObjectKeyPattern.MatchString(key) {
		return "", "", ErrLibraryObjectNotFound
	}
	name := strings.TrimPrefix(key, "library/")
	return filepath.Join(s.root, name+".blob"), filepath.Join(s.root, name+".json"), nil
}

func (s *LocalLibraryObjectStore) Put(_ context.Context, key string, body io.Reader, metadata LibraryObjectMetadata) error {
	if err := validateLibraryObject(key, metadata); err != nil {
		return err
	}
	objectPath, metadataPath, _ := s.paths(key)
	temporary, err := os.CreateTemp(s.root, ".upload-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(temporary, hasher), io.LimitReader(body, metadata.ByteSize+1))
	if copyErr == nil {
		copyErr = temporary.Sync()
	}
	if closeErr := temporary.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		return copyErr
	}
	if written != metadata.ByteSize || hex.EncodeToString(hasher.Sum(nil)) != metadata.SHA256 {
		return errors.New("Library object does not match upload constraints")
	}
	if err := os.Chmod(temporaryPath, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, objectPath); err != nil {
		return err
	}
	raw, _ := json.Marshal(metadata)
	if err := os.WriteFile(metadataPath, raw, 0o600); err != nil {
		_ = os.Remove(objectPath)
		return err
	}
	return nil
}

func (s *LocalLibraryObjectStore) Head(_ context.Context, key string) (LibraryObjectMetadata, error) {
	objectPath, metadataPath, err := s.paths(key)
	if err != nil {
		return LibraryObjectMetadata{}, err
	}
	info, err := os.Stat(objectPath)
	if errors.Is(err, os.ErrNotExist) {
		return LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	if err != nil {
		return LibraryObjectMetadata{}, err
	}
	raw, err := os.ReadFile(metadataPath)
	if errors.Is(err, os.ErrNotExist) {
		return LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	if err != nil {
		return LibraryObjectMetadata{}, err
	}
	var metadata LibraryObjectMetadata
	if json.Unmarshal(raw, &metadata) != nil || metadata.ByteSize != info.Size() || validateLibraryObject(key, metadata) != nil {
		return LibraryObjectMetadata{}, errors.New("local Library object metadata is invalid")
	}
	return metadata, nil
}

func (s *LocalLibraryObjectStore) Open(ctx context.Context, key string) (io.ReadCloser, LibraryObjectMetadata, error) {
	metadata, err := s.Head(ctx, key)
	if err != nil {
		return nil, LibraryObjectMetadata{}, err
	}
	objectPath, _, _ := s.paths(key)
	file, err := os.Open(objectPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	return file, metadata, err
}

func (s *LocalLibraryObjectStore) Delete(_ context.Context, key string) error {
	objectPath, metadataPath, err := s.paths(key)
	if err != nil {
		return err
	}
	if err := os.Remove(objectPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Remove(metadataPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func NewMemoryLibraryObjectStore() *MemoryLibraryObjectStore {
	return &MemoryLibraryObjectStore{objects: map[string]memoryLibraryObject{}}
}

func (s *MemoryLibraryObjectStore) Put(_ context.Context, key string, body io.Reader, metadata LibraryObjectMetadata) error {
	if err := validateLibraryObject(key, metadata); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(body, metadata.ByteSize+1))
	if err != nil {
		return err
	}
	actual := sha256.Sum256(data)
	if int64(len(data)) != metadata.ByteSize || hex.EncodeToString(actual[:]) != metadata.SHA256 {
		return errors.New("library object does not match upload constraints")
	}
	s.mu.Lock()
	s.objects[key] = memoryLibraryObject{data: append([]byte(nil), data...), metadata: metadata}
	s.mu.Unlock()
	return nil
}

func (s *MemoryLibraryObjectStore) Head(_ context.Context, key string) (LibraryObjectMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	object, ok := s.objects[key]
	if !ok {
		return LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	return object.metadata, nil
}

func (s *MemoryLibraryObjectStore) Open(_ context.Context, key string) (io.ReadCloser, LibraryObjectMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	object, ok := s.objects[key]
	if !ok {
		return nil, LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(append([]byte(nil), object.data...))), object.metadata, nil
}

func (s *MemoryLibraryObjectStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	delete(s.objects, key)
	s.mu.Unlock()
	return nil
}

type S3LibraryObjectStoreConfig struct {
	Endpoint           string
	Region             string
	Bucket             string
	AccessKeyID        string
	SecretAccessKey    string
	ForcePathStyle     bool
	BucketPrivate      bool
	PermanentBucket    bool
	AllowInsecureLocal bool
	HTTPClient         *http.Client
}

type libraryS3API interface {
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	DeleteObject(context.Context, *s3.DeleteObjectInput, ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

type S3LibraryObjectStore struct {
	bucket string
	client libraryS3API
}

func NewS3LibraryObjectStore(config S3LibraryObjectStoreConfig) (*S3LibraryObjectStore, error) {
	if err := validateS3LibraryObjectStoreConfig(config); err != nil {
		return nil, err
	}
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = newLibraryHTTPClient()
	}
	options := s3.Options{
		Region:       strings.TrimSpace(config.Region),
		Credentials:  credentials.NewStaticCredentialsProvider(strings.TrimSpace(config.AccessKeyID), strings.TrimSpace(config.SecretAccessKey), ""),
		HTTPClient:   httpClient,
		UsePathStyle: config.ForcePathStyle,
		Retryer:      retry.NewStandard(func(options *retry.StandardOptions) { options.MaxAttempts = 3 }),
	}
	if endpoint := strings.TrimSpace(config.Endpoint); endpoint != "" {
		options.BaseEndpoint = aws.String(strings.TrimRight(endpoint, "/"))
	}
	return &S3LibraryObjectStore{bucket: strings.TrimSpace(config.Bucket), client: s3.New(options)}, nil
}

func validateS3LibraryObjectStoreConfig(config S3LibraryObjectStoreConfig) error {
	if strings.TrimSpace(config.Bucket) == "" || strings.ContainsAny(config.Bucket, "/\\\x00\r\n") {
		return errors.New("Library bucket is required and must not contain path separators")
	}
	if strings.TrimSpace(config.Region) == "" {
		return errors.New("Library S3 region is required (use auto for Cloudflare R2)")
	}
	if strings.TrimSpace(config.AccessKeyID) == "" || strings.TrimSpace(config.SecretAccessKey) == "" {
		return errors.New("Library S3 credentials are required")
	}
	if !config.BucketPrivate {
		return errors.New("Library bucket must be private")
	}
	if !config.PermanentBucket {
		return errors.New("Library storage must use a permanent bucket without the Agent attachment expiry rule")
	}
	if endpoint := strings.TrimSpace(config.Endpoint); endpoint != "" {
		parsed, err := url.Parse(endpoint)
		if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
			return errors.New("Library S3 endpoint must be an origin URL without credentials, path, query, or fragment")
		}
		if parsed.Scheme != "https" && !(config.AllowInsecureLocal && parsed.Scheme == "http" && isLoopbackAttachmentHost(parsed.Hostname())) {
			return errors.New("Library S3 endpoint must use HTTPS")
		}
	}
	return nil
}

func (s *S3LibraryObjectStore) Put(ctx context.Context, key string, body io.Reader, metadata LibraryObjectMetadata) error {
	if err := validateLibraryObject(key, metadata); err != nil {
		return err
	}
	checksum, _ := hex.DecodeString(metadata.SHA256)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(key), Body: body,
		ContentLength: aws.Int64(metadata.ByteSize), ContentType: aws.String(metadata.MIMEType),
		ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(checksum)),
		Metadata:       map[string]string{librarySHA256MetadataKey: metadata.SHA256},
	})
	return mapLibraryS3Error(err)
}

func (s *S3LibraryObjectStore) Head(ctx context.Context, key string) (LibraryObjectMetadata, error) {
	if !libraryObjectKeyPattern.MatchString(key) {
		return LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	result, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		return LibraryObjectMetadata{}, mapLibraryS3Error(err)
	}
	return libraryS3Metadata(result.ContentLength, result.ContentType, result.Metadata)
}

func (s *S3LibraryObjectStore) Open(ctx context.Context, key string) (io.ReadCloser, LibraryObjectMetadata, error) {
	if !libraryObjectKeyPattern.MatchString(key) {
		return nil, LibraryObjectMetadata{}, ErrLibraryObjectNotFound
	}
	ctx, cancel := context.WithCancel(ctx)
	result, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		cancel()
		return nil, LibraryObjectMetadata{}, mapLibraryS3Error(err)
	}
	metadata, err := libraryS3Metadata(result.ContentLength, result.ContentType, result.Metadata)
	if err != nil {
		cancel()
		_ = result.Body.Close()
		return nil, LibraryObjectMetadata{}, err
	}
	return &cancelOnCloseReadCloser{ReadCloser: result.Body, cancel: cancel}, metadata, nil
}

func (s *S3LibraryObjectStore) Delete(ctx context.Context, key string) error {
	if !libraryObjectKeyPattern.MatchString(key) {
		return ErrLibraryObjectNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	return mapLibraryS3Error(err)
}

func validateLibraryObject(key string, metadata LibraryObjectMetadata) error {
	if !libraryObjectKeyPattern.MatchString(key) || metadata.ByteSize < 1 || metadata.ByteSize > 1_000_000_000 || !sha256Pattern.MatchString(metadata.SHA256) {
		return errors.New("invalid Library object constraints")
	}
	return nil
}

func libraryS3Metadata(contentLength *int64, contentType *string, values map[string]string) (LibraryObjectMetadata, error) {
	if contentLength == nil || *contentLength < 1 {
		return LibraryObjectMetadata{}, errors.New("Library object has invalid size metadata")
	}
	checksum := strings.ToLower(strings.TrimSpace(values[librarySHA256MetadataKey]))
	if !sha256Pattern.MatchString(checksum) {
		return LibraryObjectMetadata{}, errors.New("Library object is missing verified checksum metadata")
	}
	return LibraryObjectMetadata{ByteSize: *contentLength, SHA256: checksum, MIMEType: aws.ToString(contentType)}, nil
}

func mapLibraryS3Error(err error) error {
	if err == nil {
		return nil
	}
	var responseError *smithyhttp.ResponseError
	if errors.As(err, &responseError) && responseError.HTTPStatusCode() == http.StatusNotFound {
		return ErrLibraryObjectNotFound
	}
	var apiError smithy.APIError
	if errors.As(err, &apiError) && (apiError.ErrorCode() == "NoSuchKey" || apiError.ErrorCode() == "NotFound") {
		return ErrLibraryObjectNotFound
	}
	return fmt.Errorf("Library object store: %w", err)
}

func newLibraryHTTPClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     true,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: time.Second,
		IdleConnTimeout:       60 * time.Second,
		MaxIdleConns:          50,
		MaxIdleConnsPerHost:   10,
	}}
}
