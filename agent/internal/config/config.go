// Package config loads and persists agent configuration. Precedence:
// command line flags > environment variables > config.json > defaults.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	// DeviceName is the human friendly name announced to peers.
	DeviceName string `json:"deviceName"`
	// APIBind is the address the local HTTP API listens on.
	APIBind string `json:"apiBind"`
	// APIPort is the local HTTP API port.
	APIPort int `json:"apiPort"`
	// PeerPort is the TCP port peers connect to for synchronization.
	PeerPort int `json:"peerPort"`
	// BandwidthLimitBps caps aggregate transfer throughput. 0 = unlimited.
	BandwidthLimitBps int64 `json:"bandwidthLimitBps"`
	// ConcurrentTransfers is the number of file transfers running in
	// parallel. Range 1..8.
	ConcurrentTransfers int `json:"concurrentTransfers"`
	// ChunkSizeBytes is the transfer chunk size. Range 64KiB..16MiB.
	ChunkSizeBytes int64 `json:"chunkSizeBytes"`
	// DiscoveryEnabled controls the UDP multicast discovery beacon.
	DiscoveryEnabled bool `json:"discoveryEnabled"`
	// SkipHiddenFiles ignores dot-files when indexing.
	SkipHiddenFiles bool `json:"skipHiddenFiles"`
	// AutoSyncSeconds runs sync with all trusted peers periodically.
	// 0 = manual only.
	AutoSyncSeconds int `json:"autoSyncSeconds"`
	// APIToken, when set, requires Bearer auth on the local API.
	APIToken string `json:"apiToken,omitempty"`
	// NativePath points at the optional C++ hashing worker binary.
	NativePath string `json:"nativePath,omitempty"`
	// HashViaNativeThreshold: files at least this size are hashed by the
	// C++ worker when available. Below it, Go hashes inline.
	HashViaNativeThreshold int64 `json:"hashViaNativeThresholdBytes"`
}

func Defaults() Config {
	return Config{
		DeviceName:             "",
		APIBind:                "127.0.0.1",
		APIPort:                3040,
		PeerPort:               4040,
		BandwidthLimitBps:      0,
		ConcurrentTransfers:    2,
		ChunkSizeBytes:         1024 * 1024,
		DiscoveryEnabled:       true,
		SkipHiddenFiles:        false,
		AutoSyncSeconds:        0,
		HashViaNativeThreshold: 1024 * 1024,
	}
}

// Validate clamps numeric fields into their allowed ranges.
func (c *Config) Validate() error {
	if c.ConcurrentTransfers < 1 || c.ConcurrentTransfers > 8 {
		return fmt.Errorf("concurrentTransfers must be between 1 and 8")
	}
	if c.ChunkSizeBytes < 64*1024 || c.ChunkSizeBytes > 16*1024*1024 {
		return fmt.Errorf("chunkSizeBytes must be between 64KiB and 16MiB")
	}
	if c.BandwidthLimitBps < 0 {
		return fmt.Errorf("bandwidthLimitBps must be >= 0")
	}
	if c.AutoSyncSeconds < 0 || (c.AutoSyncSeconds != 0 && c.AutoSyncSeconds < 10) {
		return fmt.Errorf("autoSyncSeconds must be 0 or at least 10")
	}
	if len(c.DeviceName) > 64 {
		return fmt.Errorf("deviceName must be at most 64 characters")
	}
	return nil
}

// Load reads config.json from stateDir, applies env overrides, and returns
// the effective configuration. The file is created with defaults when
// missing so operators can edit it.
func Load(stateDir string, env []string) (Config, error) {
	cfg := Defaults()
	path := filepath.Join(stateDir, "config.json")
	if raw, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("parse %s: %w", path, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return cfg, err
	} else if err := save(path, cfg); err != nil {
		return cfg, err
	}

	envMap := map[string]string{}
	for _, kv := range env {
		for i := 0; i < len(kv); i++ {
			if kv[i] == '=' {
				envMap[kv[:i]] = kv[i+1:]
				break
			}
		}
	}
	if v := envMap["MESHSYNC_NAME"]; v != "" {
		cfg.DeviceName = v
	}
	if v := envMap["MESHSYNC_API_BIND"]; v != "" {
		cfg.APIBind = v
	}
	if v := envMap["MESHSYNC_API_PORT"]; v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.APIPort = p
		}
	}
	if v := envMap["MESHSYNC_PEER_PORT"]; v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.PeerPort = p
		}
	}
	if v := envMap["MESHSYNC_API_TOKEN"]; v != "" {
		cfg.APIToken = v
	}
	if v := envMap["MESHSYNC_NATIVE_PATH"]; v != "" {
		cfg.NativePath = v
	}
	if v := envMap["MESHSYNC_DATA_DIR"]; v != "" {
		_ = v // consumed by the caller (main) before Load
	}
	return cfg, cfg.Validate()
}

// Save persists the mutable subset of the configuration.
func (c *Config) Save(stateDir string) error {
	return save(filepath.Join(stateDir, "config.json"), *c)
}

func save(path string, c Config) error {
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}
