// meshsync-agent runs the MeshSync local agent: peer discovery, trusted
// pairing, file indexing, chunked transfer and the local REST/WebSocket
// API consumed by the web and Flutter clients.
//
// Usage:
//
//	meshsync-agent [--data-dir DIR] [--api-port N] [--peer-port N]
//	               [--api-bind ADDR] [--name NAME] [--api-token TOKEN]
//	               [--native-path PATH] [--version]
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/ParsaFathii/MeshSync/agent/internal/api"
	"github.com/ParsaFathii/MeshSync/agent/internal/app"
	"github.com/ParsaFathii/MeshSync/agent/internal/config"
	"github.com/ParsaFathii/MeshSync/agent/internal/identity"
	"github.com/ParsaFathii/MeshSync/agent/internal/netproto"
	"github.com/ParsaFathii/MeshSync/agent/internal/store"
	"github.com/ParsaFathii/MeshSync/agent/internal/version"
)

func main() {
	dataDir := flag.String("data-dir", defaultDataDir(), "state directory (identity, database, trash)")
	apiPort := flag.Int("api-port", 0, "local HTTP API port (0 = config value)")
	peerPort := flag.Int("peer-port", 0, "peer TCP port (0 = config value)")
	apiBind := flag.String("api-bind", "", "local HTTP API bind address")
	name := flag.String("name", "", "device name announced to peers")
	apiToken := flag.String("api-token", "", "require Bearer auth on the local API")
	nativePath := flag.String("native-path", "", "path to the C++ hashing worker binary")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("%s %s (%s/%s)\n", version.AgentName, version.Version, runtime.GOOS, runtime.GOARCH)
		return
	}

	if err := run(*dataDir, *apiPort, *peerPort, *apiBind, *name, *apiToken, *nativePath); err != nil {
		fmt.Fprintf(os.Stderr, "meshsync-agent: %v\n", err)
		os.Exit(1)
	}
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".meshsync"
	}
	return filepath.Join(home, ".meshsync")
}

func run(dataDir string, apiPort, peerPort int, apiBind, name, apiToken, nativePath string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	if v := os.Getenv("MESHSYNC_DATA_DIR"); v != "" {
		dataDir = v
	}

	cfg, err := config.Load(dataDir, os.Environ())
	if err != nil {
		return err
	}
	if apiPort != 0 {
		cfg.APIPort = apiPort
	}
	if peerPort != 0 {
		cfg.PeerPort = peerPort
	}
	if apiBind != "" {
		cfg.APIBind = apiBind
	}
	if name != "" {
		cfg.DeviceName = name
	}
	if apiToken != "" {
		cfg.APIToken = apiToken
	}
	if nativePath != "" {
		cfg.NativePath = nativePath
	}
	if cfg.DeviceName == "" {
		cfg.DeviceName = defaultDeviceName()
	}
	if err := cfg.Validate(); err != nil {
		return err
	}

	id, err := identity.Load(dataDir)
	if err != nil {
		return err
	}
	cert, err := netproto.EnsureCert(dataDir, id)
	if err != nil {
		return err
	}

	dbPath := filepath.Join(dataDir, "meshsync.db")
	db, err := store.Open(dbPath)
	if err != nil {
		return err
	}

	agent := app.New(dataDir, cfg, id, cert, db)
	if err := agent.Start(); err != nil {
		return err
	}

	apiSrv := api.New(agent)
	addr := fmt.Sprintf("%s:%d", cfg.APIBind, cfg.APIPort)
	if err := apiSrv.Listen(addr); err != nil {
		agent.Stop()
		return fmt.Errorf("api listener: %w", err)
	}

	fmt.Printf("%s %s listening on http://%s (peer %d, id %s)\n",
		version.AgentName, version.Version, addr, cfg.PeerPort, id.PeerID)

	select {} // blocks until killed; subsystems handle shutdown state
}

func defaultDeviceName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "meshsync-device"
	}
	return host
}
