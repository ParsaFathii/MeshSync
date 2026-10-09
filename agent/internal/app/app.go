// Package app wires every MeshSync subsystem together and implements the
// server-side peer protocol handlers: chunk serving, chunk receiving,
// deletions, adoption, conflict mirroring and passive transfer records.
package app

import (
        "crypto/ed25519"
        "crypto/tls"
        "fmt"
        "net"
        "os"
        "path/filepath"
        "runtime"
        "strconv"
        "sync"
        "sync/atomic"
        "time"

        "github.com/ParsaFathii/MeshSync/agent/internal/config"
        "github.com/ParsaFathii/MeshSync/agent/internal/events"
        "github.com/ParsaFathii/MeshSync/agent/internal/identity"
        "github.com/ParsaFathii/MeshSync/agent/internal/indexer"
        "github.com/ParsaFathii/MeshSync/agent/internal/native"
        "github.com/ParsaFathii/MeshSync/agent/internal/netproto"
        "github.com/ParsaFathii/MeshSync/agent/internal/store"
        syncengine "github.com/ParsaFathii/MeshSync/agent/internal/sync"
        "github.com/ParsaFathii/MeshSync/agent/internal/transfer"
        "github.com/ParsaFathii/MeshSync/agent/internal/version"
)

// Agent is the running MeshSync instance.
type Agent struct {
        Cfg      config.Config
        StateDir string
        ID       *identity.Identity
        Cert     tls.Certificate
        DB       *store.DB
        Bus      *events.Bus
        Native   *native.Worker
        Indexer  *indexer.Indexer
        Engine   *syncengine.Engine
        Manager  *transfer.Manager
        Band     *transfer.Bandwidth

        cfgMu sync.RWMutex

        server  *netproto.Server
        stopped atomic.Bool

        peersMu     sync.Mutex
        lastContact map[string]time.Time // peerID -> last successful contact
        peerFolders map[string][]string  // folder names announced in the last HELLO
        monitorNext map[string]time.Time
        monitorFail map[string]int

        passiveMu   sync.Mutex
        passive     map[string]passiveTransfer // key: peerID|folder|path
        backupReq   map[string]bool            // FileBegin asked for trash-before-replace
        broadcastFn func(kind string, payload any)
}

type passiveTransfer struct {
        id         string
        direction  string
        lastUpdate time.Time
}

// SetBroadcast is used by the API layer to push frames to WebSocket clients.
func (a *Agent) SetBroadcast(fn func(kind string, payload any)) { a.broadcastFn = fn }

func (a *Agent) broadcast(kind string, payload any) {
        if fn := a.broadcastFn; fn != nil {
                fn(kind, payload)
        }
}

// New assembles the agent. Call Start to run it.
func New(stateDir string, cfg config.Config, id *identity.Identity, cert tls.Certificate, db *store.DB) *Agent {
        bus := events.NewBus(db)
        a := &Agent{
                Cfg: cfg, StateDir: stateDir, ID: id, Cert: cert, DB: db, Bus: bus,
                lastContact: map[string]time.Time{}, peerFolders: map[string][]string{},
                monitorNext: map[string]time.Time{}, monitorFail: map[string]int{},
                passive: map[string]passiveTransfer{}, backupReq: map[string]bool{},
        }
        a.Native = native.Start(cfg.NativePath, bus)
        a.Indexer = indexer.New(db, bus, a.Native, cfg.SkipHiddenFiles)
        a.Band = transfer.NewBandwidth(cfg.BandwidthLimitBps)
        a.Manager = transfer.NewManager(db, bus, a.Band, nil, cfg.ConcurrentTransfers)
        a.Engine = syncengine.NewEngine(db, bus, a.Indexer, a.Manager, stateDir)
        a.Engine.SetDeps(syncengine.Deps{
                CertPinner: a.CertPinner,
                Dialer:     a.DialPeer,
                SelfHello:  a.SelfHello,
                Config:     a.LiveConfig,
        })
        // resolve the Engine<->Manager cycle: the manager executes transfers
        // through the engine once both exist (before Start is called).
        a.Manager.SetExecutor(a.Engine)
        a.Manager.OnState(func(t *transfer.Transfer) {
                a.broadcast("transfer", t)
        })
        return a
}

// Start brings the agent online.
func (a *Agent) Start() error {
        if n, err := a.DB.ResetInterruptedTransfers(); err == nil && n > 0 {
                a.Bus.Emit("TRANSFER_PAUSED", "WARN",
                        fmt.Sprintf("%d transfer(s) interrupted by restart were moved to PAUSED", n), nil)
        }
        // cancelled transfers are abandoned: purge their stale part files now
        // (failed transfers keep theirs — parts are the retry-resume data)
        a.Engine.PurgeCancelledParts()

        srv, err := netproto.NewServer(net.JoinHostPort("0.0.0.0", strconv.Itoa(a.LiveConfig().PeerPort)), a.Cert, a)
        if err != nil {
                return fmt.Errorf("peer listener: %w", err)
        }
        a.server = srv
        go func() { _ = srv.Serve() }()

        a.Manager.Start()

        // index + watch existing folders
        folders, _ := a.DB.ListFolders()
        for _, f := range folders {
                if _, _, _, err := a.Indexer.Rescan(f); err != nil {
                        a.Bus.Emit("SYNC_FAILED", "ERROR", fmt.Sprintf("rescan %s: %v", f.Name, err), nil)
                }
                _ = a.Indexer.StartWatching(f)
        }

        go a.monitorLoop()
        if a.LiveConfig().DiscoveryEnabled {
                go a.discoveryLoop()
        }
        if a.LiveConfig().AutoSyncSeconds > 0 {
                go a.autoSyncLoop()
        }
        a.Bus.Emit("PEER_ONLINE", "INFO",
                fmt.Sprintf("%s %s started (peer port %d)", version.AgentName, version.Version, a.LiveConfig().PeerPort),
                map[string]any{"version": version.Version})
        return nil
}

// Stop shuts everything down cleanly.
func (a *Agent) Stop() {
        if !a.stopped.CompareAndSwap(false, true) {
                return
        }
        if a.server != nil {
                a.server.Close()
        }
        a.Manager.Stop()
        a.Native.Stop()
        _ = a.DB.Close()
}

func (a *Agent) LiveConfig() config.Config {
        a.cfgMu.RLock()
        defer a.cfgMu.RUnlock()
        return a.Cfg
}

// ApplyConfig updates live settings.
func (a *Agent) ApplyConfig(cfg config.Config) {
        a.cfgMu.Lock()
        a.Cfg = cfg
        a.cfgMu.Unlock()
        a.Band.SetRate(cfg.BandwidthLimitBps)
        a.Manager.SetConcurrency(cfg.ConcurrentTransfers)
        a.Indexer.SetSkipHidden(cfg.SkipHiddenFiles)
}

// ApplySettings validates, persists and applies new settings.
func (a *Agent) ApplySettings(cfg config.Config) error {
        if err := cfg.Validate(); err != nil {
                return err
        }
        if err := cfg.Save(a.StateDir); err != nil {
                return fmt.Errorf("persist settings: %w", err)
        }
        a.ApplyConfig(cfg)
        return nil
}

// SelfHello is our HELLO announcement.
func (a *Agent) SelfHello() *netproto.Hello {
        folders, _ := a.DB.ListFolders()
        names := make([]string, 0, len(folders))
        for _, f := range folders {
                names = append(names, f.Name)
        }
        return &netproto.Hello{
                PeerID: a.ID.PeerID, Name: a.LiveConfig().DeviceName,
                Version: version.Version, Platform: platform(), Folders: names,
                Listen: a.LiveConfig().PeerPort,
        }
}

// CertPinner resolves a peer's address and pinned public key.
func (a *Agent) CertPinner(peerID string) (pinnedKey []byte, address string, ok bool) {
        p, found, err := a.DB.GetPeer(peerID)
        if err != nil || !found || p.Trust != store.Trusted {
                return nil, "", false
        }
        pub, err := identity.DecodePublicKey(p.Pubkey)
        if err != nil {
                return nil, "", false
        }
        if p.Address == "" {
                return nil, "", false
        }
        return pub, p.Address, true
}

// DialPeer opens a HELLO-exchanged connection to a trusted peer.
func (a *Agent) DialPeer(address string, pinnedKey []byte) (*netproto.Conn, error) {
        var expected ed25519.PublicKey
        if len(pinnedKey) == ed25519.PublicKeySize {
                expected = ed25519.PublicKey(pinnedKey)
        }
        conn, hello, err := netproto.Dial(address, a.Cert, a.SelfHello(), expected, 10*time.Second)
        if err != nil {
                return nil, err
        }
        a.recordHello(hello, address)
        return conn, nil
}

func (a *Agent) recordHello(h *netproto.Hello, address string) {
        if h == nil || h.PeerID == "" {
                return
        }
        foundPeer, _, _ := a.DB.GetPeer(h.PeerID)
        found := foundPeer
        entry := store.Peer{
                PeerID: h.PeerID, Name: h.Name, Address: address,
                Version: h.Version, Platform: h.Platform, LastSeen: time.Now().Unix(),
        }
        if found.PeerID != "" {
                entry.Pubkey = found.Pubkey
                entry.Trust = found.Trust
                entry.AddedAt = found.AddedAt
                if address == "" {
                        entry.Address = found.Address
                }
        }
        _, _ = a.DB.UpsertDiscoveredPeer(entry)
        a.peersMu.Lock()
        wasOnline := a.isOnlineLocked(h.PeerID)
        a.lastContact[h.PeerID] = time.Now()
        a.peerFolders[h.PeerID] = h.Folders
        a.peersMu.Unlock()
        // the peer already marked this device as trusted: converge trust
        // (pairing was explicitly initiated on this side, so this matches
        // the documented approve semantics)
        if h.TrustYou {
                if p, ok, _ := a.DB.GetPeer(h.PeerID); ok && p.Trust == store.Pairing {
                        _ = a.DB.SetPeerTrust(h.PeerID, store.Trusted)
                        a.Bus.Emit("PAIR_APPROVED", "INFO", fmt.Sprintf("Paired with %s (%s)", h.Name, h.PeerID), map[string]any{"peer": h.Name})
                }
        }
        if !wasOnline {
                a.broadcast("peers", nil)
        }
}

// IsOnline reports live reachability: a peer is online when it answered
// within the last contact window (probes run every 10s while healthy).
func (a *Agent) IsOnline(peerID string) bool {
        a.peersMu.Lock()
        defer a.peersMu.Unlock()
        return a.isOnlineLocked(peerID)
}

const onlineWindow = 11 * time.Second

func (a *Agent) isOnlineLocked(peerID string) bool {
        if t, ok := a.lastContact[peerID]; ok {
                return time.Since(t) <= onlineWindow
        }
        return false
}

// PeerSharedFolders returns the folder names the peer last announced.
func (a *Agent) PeerSharedFolders(peerID string) []string {
        a.peersMu.Lock()
        defer a.peersMu.Unlock()
        return a.peerFolders[peerID]
}

// ---- pairing ----

// Pair sends a pairing request to address (host:peerPort). The key is
// learned from the peer's certificate during this first connection.
func (a *Agent) Pair(address string) (store.Peer, error) {
        conn, hello, err := netproto.Dial(address, a.Cert, a.SelfHello(), nil, 10*time.Second)
        if err != nil {
                return store.Peer{}, fmt.Errorf("cannot reach %s: %w", address, err)
        }
        a.recordHello(hello, address)
        defer conn.Close()
        peerID, err := conn.PeerIDFromHandshake()
        if err != nil {
                return store.Peer{}, err
        }
        pubHex, err := conn.RemotePubkeyHex()
        if err != nil {
                return store.Peer{}, err
        }
        if peerID == a.ID.PeerID {
                return store.Peer{}, fmt.Errorf("that address is this device itself")
        }
        decision, err := netproto.SendPairRequest(conn, &netproto.PairRequest{
                PeerID: a.ID.PeerID, Name: a.LiveConfig().DeviceName, Version: version.Version, Platform: platform(),
        })
        if err != nil {
                return store.Peer{}, err
        }
        trust := store.Pairing
        if decision == netproto.PairDecisionApproved {
                trust = store.Trusted
        } else if decision == netproto.PairDecisionRejected {
                trust = store.Discovered
        }
        entry := store.Peer{
                PeerID: peerID, Name: hello.Name, Address: address,
                Pubkey: pubHex, Trust: trust, Version: hello.Version,
                Platform: hello.Platform, LastSeen: time.Now().Unix(), AddedAt: time.Now().Unix(),
        }
        if existing, ok, _ := a.DB.GetPeer(peerID); ok {
                entry.AddedAt = existing.AddedAt
        }
        _, err = a.DB.UpsertDiscoveredPeer(entry)
        if err != nil {
                return entry, err
        }
        // UpsertDiscoveredPeer never changes trust of an existing row, so
        // the pairing state must be set explicitly.
        if trust != store.Trusted {
                _ = a.DB.SetPeerTrust(peerID, trust)
        }
        if decision == netproto.PairDecisionApproved {
                _ = a.DB.SetPeerTrust(peerID, store.Trusted)
                a.Bus.Emit("PAIR_APPROVED", "INFO", fmt.Sprintf("Paired with %s (%s)", entry.Name, peerID), map[string]any{"peer": entry.Name})
        } else if decision == netproto.PairDecisionPending {
                a.Bus.Emit("PAIR_REQUESTED", "INFO",
                        fmt.Sprintf("Pairing requested with %s; approve it on that device to enable sync", entry.Name),
                        map[string]any{"peer": entry.Name})
        } else {
                a.Bus.Emit("PEER_REVOKED", "WARN", fmt.Sprintf("%s rejected the pairing request", entry.Name), nil)
        }
        a.broadcast("peers", nil)
        return entry, nil
}

// Approve marks a peer trusted and notifies it so both sides converge.
func (a *Agent) Approve(peerID string) error {
        p, ok, err := a.DB.GetPeer(peerID)
        if err != nil || !ok {
                return fmt.Errorf("peer %s not found", peerID)
        }
        if err := a.DB.SetPeerTrust(peerID, store.Trusted); err != nil {
                return err
        }
        a.Bus.Emit("PAIR_APPROVED", "INFO", fmt.Sprintf("Trusted peer %s (%s)", p.Name, peerID), map[string]any{"peer": p.Name})
        go func() {
                pub, err := identity.DecodePublicKey(p.Pubkey)
                if err != nil {
                        return
                }
                conn, hello, err := netproto.Dial(p.Address, a.Cert, a.SelfHello(), pub, 10*time.Second)
                if err != nil {
                        return
                }
                defer conn.Close()
                a.recordHello(hello, p.Address)
                _ = netproto.SendPairApproved(conn)
        }()
        a.broadcast("peers", nil)
        return nil
}

// Revoke removes trust from a peer.
func (a *Agent) Revoke(peerID string) error {
        p, ok, err := a.DB.GetPeer(peerID)
        if err != nil || !ok {
                return fmt.Errorf("peer %s not found", peerID)
        }
        if err := a.DB.SetPeerTrust(peerID, store.Revoked); err != nil {
                return err
        }
        a.peersMu.Lock()
        delete(a.lastContact, peerID)
        a.peersMu.Unlock()
        a.Bus.Emit("PEER_REVOKED", "WARN", fmt.Sprintf("Revoked peer %s (%s)", p.Name, peerID), map[string]any{"peer": p.Name})
        a.broadcast("peers", nil)
        return nil
}

// Remove deletes a peer record entirely.
func (a *Agent) Remove(peerID string) error { return a.DB.DeletePeer(peerID) }

// ---- discovery (UDP multicast beacons) ----

const (
        discoveryGroup = "239.255.42.42"
        discoveryPort  = 4100
)

type beacon struct {
        PeerID   string `json:"peerId"`
        Name     string `json:"name"`
        Version  string `json:"version"`
        PeerPort int    `json:"peerPort"`
}

func (a *Agent) discoveryLoop() {
        conn, err := a.listenDiscovery()
        if err != nil {
                a.Bus.Emit("PEER_DISCOVERED", "WARN", "discovery listener unavailable: "+err.Error(), nil)
                return
        }
        go a.readBeacons(conn)
        ticker := time.NewTicker(5 * time.Second)
        defer ticker.Stop()
        a.sendBeacon()
        for {
                if a.stopped.Load() {
                        return
                }
                <-ticker.C
                if !a.LiveConfig().DiscoveryEnabled {
                        continue
                }
                a.sendBeacon()
        }
}

func (a *Agent) listenDiscovery() (*net.UDPConn, error) {
        addr := &net.UDPAddr{IP: net.ParseIP(discoveryGroup), Port: discoveryPort}
        // ListenMulticastUDP joins the group on all multicast interfaces with
        // SO_REUSEADDR, so several agents on one host coexist.
        conn, err := net.ListenMulticastUDP("udp4", nil, addr)
        if err != nil {
                return nil, err
        }
        return conn, nil
}

func (a *Agent) sendBeacon() {
        cfg := a.LiveConfig()
        payload := marshalBeacon(beacon{
                PeerID: a.ID.PeerID, Name: cfg.DeviceName, Version: version.Version, PeerPort: cfg.PeerPort,
        })
        conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.ParseIP(discoveryGroup), Port: discoveryPort})
        if err == nil {
                _, _ = conn.Write(payload)
                conn.Close()
        }
}

func (a *Agent) readBeacons(conn *net.UDPConn) {
        buf := make([]byte, 2048)
        for {
                conn.SetReadDeadline(time.Now().Add(2 * time.Second))
                n, from, err := conn.ReadFromUDP(buf)
                if a.stopped.Load() {
                        return
                }
                if err != nil {
                        if ne, ok := err.(net.Error); ok && ne.Timeout() {
                                continue
                        }
                        return
                }
                var b beacon
                if unmarshalBeacon(buf[:n], &b) != nil || b.PeerID == "" || b.PeerID == a.ID.PeerID {
                        continue
                }
                address := net.JoinHostPort(from.IP.String(), strconv.Itoa(b.PeerPort))
                p, found, _ := a.DB.GetPeer(b.PeerID)
                entry := store.Peer{
                        PeerID: b.PeerID, Name: b.Name, Address: address,
                        Version: b.Version, LastSeen: time.Now().Unix(),
                }
                if found {
                        entry.Pubkey = p.Pubkey
                        entry.Trust = p.Trust
                        entry.AddedAt = p.AddedAt
                        entry.Platform = p.Platform
                }
                created, err := a.DB.UpsertDiscoveredPeer(entry)
                if err == nil && created {
                        a.Bus.Emit("PEER_DISCOVERED", "INFO",
                                fmt.Sprintf("Discovered %s at %s", b.Name, address),
                                map[string]any{"peer": b.Name, "peerId": b.PeerID, "address": address})
                        a.broadcast("peers", nil)
                }
        }
}

// ScanDiscovery performs one beacon sweep and returns discovered peers.
func (a *Agent) ScanDiscovery() ([]store.Peer, error) {
        a.sendBeacon()
        time.Sleep(300 * time.Millisecond)
        peers, err := a.DB.ListPeers()
        if err != nil {
                return nil, err
        }
        out := []store.Peer{}
        for _, p := range peers {
                if p.Trust == store.Discovered {
                        out = append(out, p)
                }
        }
        return out, nil
}

// ---- peer monitor (online status with reconnect backoff) ----

func (a *Agent) monitorLoop() {
        ticker := time.NewTicker(2 * time.Second)
        defer ticker.Stop()
        for {
                if a.stopped.Load() {
                        return
                }
                <-ticker.C
                peers, _ := a.DB.ListPeers()
                for _, p := range peers {
                        if p.Trust != store.Trusted && p.Trust != store.Pairing {
                                continue
                        }
                        a.peersMu.Lock()
                        next, has := a.monitorNext[p.PeerID]
                        a.peersMu.Unlock()
                        if !has {
                                next = time.Now()
                                a.peersMu.Lock()
                                a.monitorNext[p.PeerID] = next
                                a.peersMu.Unlock()
                        }
                        if time.Now().Before(next) {
                                continue
                        }
                        go a.probePeer(p)
                }
        }
}

// probePeer runs one reachability probe; failures back off 10s→60s.
func (a *Agent) probePeer(p store.Peer) {
        pub, _ := identity.DecodePublicKey(p.Pubkey)
        conn, hello, err := netproto.Dial(p.Address, a.Cert, a.SelfHello(), pub, 5*time.Second)
        if err == nil {
                a.recordHello(hello, p.Address)
        }
        a.peersMu.Lock()
        was := a.isOnlineLocked(p.PeerID)
        fail := a.monitorFail[p.PeerID]
        backoff := 10 * time.Second
        if fail > 0 {
                backoff = time.Duration(fail) * 10 * time.Second
                if backoff > 60*time.Second {
                        backoff = 60 * time.Second
                }
        }
        a.monitorNext[p.PeerID] = time.Now().Add(backoff)
        a.peersMu.Unlock()

        if err != nil {
                a.peersMu.Lock()
                a.monitorFail[p.PeerID] = fail + 1
                delete(a.lastContact, p.PeerID)
                a.peersMu.Unlock()
                if was {
                        a.Bus.Emit("PEER_OFFLINE", "WARN", fmt.Sprintf("%s is unreachable", p.Name), map[string]any{"peer": p.Name})
                        a.broadcast("peers", nil)
                }
                return
        }
        defer conn.Close()
        _, _ = netproto.PingRoundTrip(conn)
        a.peersMu.Lock()
        a.monitorFail[p.PeerID] = 0
        a.lastContact[p.PeerID] = time.Now()
        a.peersMu.Unlock()
        _ = a.DB.TouchPeer(p.PeerID, time.Now().Unix())
        if !was {
                a.Bus.Emit("PEER_ONLINE", "INFO", fmt.Sprintf("%s is online", p.Name), map[string]any{"peer": p.Name})
                a.broadcast("peers", nil)
        }
}

// ---- auto sync ----

func (a *Agent) autoSyncLoop() {
        for {
                if a.stopped.Load() {
                        return
                }
                cfg := a.LiveConfig()
                if cfg.AutoSyncSeconds < 10 {
                        time.Sleep(5 * time.Second)
                        continue
                }
                time.Sleep(time.Duration(cfg.AutoSyncSeconds) * time.Second)
                a.RunAutoSync()
        }
}

// RunAutoSync syncs every folder shared with a trusted online peer.
func (a *Agent) RunAutoSync() {
        peers, _ := a.DB.ListPeers()
        folders, _ := a.DB.ListFolders()
        for _, p := range peers {
                if p.Trust != store.Trusted || !a.IsOnline(p.PeerID) {
                        continue
                }
                for _, f := range folders {
                        for _, n := range a.PeerSharedFolders(p.PeerID) {
                                if n == f.Name {
                                        _, _, _ = a.Engine.RunSync(p.PeerID, f.ID)
                                }
                        }
                }
        }
}

// ---- netproto.Handler ----

func (a *Agent) TrustState(peerID string) (store.PeerTrust, ed25519.PublicKey, bool) {
        p, ok, err := a.DB.GetPeer(peerID)
        if err != nil || !ok {
                return store.Discovered, nil, false
        }
        pub, err := identity.DecodePublicKey(p.Pubkey)
        if err != nil {
                return p.Trust, nil, true
        }
        return p.Trust, pub, true
}

func (a *Agent) OnHello(c *netproto.Conn, h *netproto.Hello) (*netproto.Hello, error) {
        // prefer the announced listen port over our view of the remote's
        // ephemeral source port so the address stays dialable
        addr := c.RemoteAddr()
        if h.Listen > 0 {
                if host, _, err := net.SplitHostPort(addr); err == nil && host != "" {
                        addr = net.JoinHostPort(host, strconv.Itoa(h.Listen))
                }
        }
        entry := store.Peer{
                PeerID: h.PeerID, Name: h.Name, Address: addr,
                Version: h.Version, Platform: h.Platform, LastSeen: time.Now().Unix(),
        }
        if p, ok, _ := a.DB.GetPeer(h.PeerID); ok {
                entry.Pubkey = p.Pubkey
                entry.Trust = p.Trust
                entry.AddedAt = p.AddedAt
                if p.Address != "" {
                        entry.Address = p.Address
                }
        }
        _, _ = a.DB.UpsertDiscoveredPeer(entry)
        a.peersMu.Lock()
        a.lastContact[h.PeerID] = time.Now()
        a.peerFolders[h.PeerID] = h.Folders
        a.peersMu.Unlock()
        our := a.SelfHello()
        our.TrustYou = entry.Trust == store.Trusted
        return our, nil
}

func (a *Agent) OnPairRequest(c *netproto.Conn, pr *netproto.PairRequest) netproto.PairDecision {
        pubHex, err := c.RemotePubkeyHex()
        if err != nil {
                return netproto.PairDecisionRejected
        }
        existing, found, _ := a.DB.GetPeer(pr.PeerID)
        entry := store.Peer{
                PeerID: pr.PeerID, Name: pr.Name, Address: c.RemoteAddr(),
                Pubkey: pubHex, Version: pr.Version, Platform: pr.Platform,
                LastSeen: time.Now().Unix(), AddedAt: time.Now().Unix(),
        }
        if found {
                entry.Trust = existing.Trust
                entry.AddedAt = existing.AddedAt
                if existing.Address != "" {
                        entry.Address = existing.Address
                }
                switch existing.Trust {
                case store.Trusted:
                        return netproto.PairDecisionApproved
                case store.Revoked:
                        return netproto.PairDecisionRejected
                }
        }
        entry.Trust = store.Pairing
        _, _ = a.DB.UpsertDiscoveredPeer(entry)
        _ = a.DB.SetPeerTrust(pr.PeerID, store.Pairing) // pairing must persist
        a.Bus.Emit("PAIR_REQUESTED", "WARN",
                fmt.Sprintf("%s requests pairing — approve it to enable synchronization", pr.Name),
                map[string]any{"peer": pr.Name, "peerId": pr.PeerID})
        a.broadcast("peers", nil)
        return netproto.PairDecisionPending
}

func (a *Agent) OnPairApproved(c *netproto.Conn) error {
        peerID := c.RemoteInfo().PeerID
        p, ok, _ := a.DB.GetPeer(peerID)
        if !ok {
                return fmt.Errorf("no pairing in progress with this peer")
        }
        if p.Trust == store.Trusted {
                return nil
        }
        if p.Trust != store.Pairing {
                return fmt.Errorf("no pairing in progress with this peer")
        }
        if err := a.DB.SetPeerTrust(peerID, store.Trusted); err != nil {
                return err
        }
        a.Bus.Emit("PAIR_APPROVED", "INFO", fmt.Sprintf("Paired with %s", p.Name), map[string]any{"peer": p.Name})
        a.broadcast("peers", nil)
        return nil
}

func (a *Agent) OnPeerGone(peerID string) {
        // Intentionally not a status change: short-lived probe and sync
        // connections open and close constantly; liveness is derived from
        // lastContact (see IsOnline).
}

// OnGetChunk serves a chunk from local disk (we are the source).
func (a *Agent) OnGetChunk(c *netproto.Conn, g *netproto.GetChunk) error {
        if g.Length <= 0 || g.Length > 16*1024*1024 || g.Offset < 0 {
                return fmt.Errorf("invalid chunk request")
        }
        folder, ok, err := a.DB.FolderByName(g.Folder)
        if err != nil || !ok {
                return fmt.Errorf("folder %s is not shared on this device", g.Folder)
        }
        abs, err := indexer.SafeJoin(folder.Path, g.Path)
        if err != nil {
                return err
        }
        f, err := os.Open(abs)
        if err != nil {
                return fmt.Errorf("file unavailable: %w", err)
        }
        defer f.Close()
        buf := make([]byte, g.Length)
        n, err := f.ReadAt(buf, g.Offset)
        if err != nil && err.Error() != "EOF" {
                return fmt.Errorf("read chunk: %w", err)
        }
        if int64(n) != g.Length {
                return fmt.Errorf("short read: requested %d at offset %d, got %d", g.Length, g.Offset, n)
        }
        a.Band.Wait(int64(n)) // our own send-side limit
        sum := hexOfHash(buf[:n])
        header := &netproto.ChunkHeader{
                Folder: g.Folder, Path: g.Path, Offset: g.Offset, Length: int64(n), Hash: sum,
        }
        frame, err := netproto.EncodeChunkFrame(header, buf[:n])
        if err != nil {
                return err
        }
        a.touchPassive(c.RemoteInfo().PeerID, g.Folder, g.Path, int64(n), "PUSH")
        return c.WriteMsg(netproto.MsgChunkData, frame)
}

// OnPutChunk receives a chunk onto our disk (we are the destination).
func (a *Agent) OnPutChunk(c *netproto.Conn, h *netproto.ChunkHeader, data []byte) (*netproto.ChunkAck, error) {
        if h.Length <= 0 || h.Length > 16*1024*1024 || h.Offset < 0 || int64(len(data)) != h.Length {
                return nil, fmt.Errorf("invalid chunk")
        }
        folder, ok, err := a.DB.FolderByName(h.Folder)
        if err != nil || !ok {
                return nil, fmt.Errorf("folder %s is not shared on this device", h.Folder)
        }
        abs, err := indexer.SafeJoin(folder.Path, h.Path)
        if err != nil {
                return nil, err
        }
        if hexOfHash(data) != h.Hash {
                return nil, fmt.Errorf("chunk hash mismatch (integrity failure)")
        }
        a.Band.Wait(h.Length) // our own receive-side limit

        peerID := c.RemoteInfo().PeerID
        partPath := syncengine.PartPath(a.StateDir, folder.ID, peerID, h.Path)
        if err := os.MkdirAll(filepath.Dir(partPath), 0o755); err != nil {
                return nil, err
        }
        if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
                return nil, err
        }
        pf, err := os.OpenFile(partPath, os.O_CREATE|os.O_RDWR, 0o644)
        if err != nil {
                return nil, fmt.Errorf("open part: %w", err)
        }
        if _, err := pf.WriteAt(data, h.Offset); err != nil {
                pf.Close()
                return nil, fmt.Errorf("write part: %w", err)
        }
        if h.FileSize > 0 {
                _ = pf.Truncate(h.FileSize)
        }
        pf.Close()

        a.touchPassive(peerID, h.Folder, h.Path, h.Length, "PULL")

        fileDone := h.FileSize > 0 && h.Offset+h.Length >= h.FileSize
        if !fileDone {
                return &netproto.ChunkAck{Folder: h.Folder, Path: h.Path, Offset: h.Offset, Ok: true}, nil
        }

        finalHash, _, err := native.HashGo(partPath)
        if err != nil {
                return nil, fmt.Errorf("verify: %w", err)
        }
        if h.FileHash != "" && finalHash != h.FileHash {
                _ = os.Remove(partPath)
                return nil, fmt.Errorf("integrity check failed: content does not match the announced hash")
        }
        // conflict resolutions ask us to keep the losing copy in the trash
        if st, err := os.Stat(abs); err == nil && st.Size() > 0 && a.takeBackupFlag(peerID, h.Folder, h.Path) {
                _ = a.Engine.TrashExisting(folder, h.Path)
        }
        if err := os.Rename(partPath, abs); err != nil {
                return nil, fmt.Errorf("finalize: %w", err)
        }
        if h.Mtime != 0 {
                _ = os.Chtimes(abs, time.UnixMilli(h.Mtime), time.UnixMilli(h.Mtime))
        }
        _ = a.DB.PutFile(store.FileEntry{
                FolderID: folder.ID, RelPath: h.Path, Size: h.FileSize, Mtime: h.Mtime,
                Hash: finalHash, LastSyncedHash: finalHash, UpdatedAt: time.Now().Unix(),
        })
        return &netproto.ChunkAck{Folder: h.Folder, Path: h.Path, Offset: h.Offset, Ok: true, FileDone: true}, nil
}

// takeBackupFlag consumes the FileBegin backup request for a path.
func (a *Agent) takeBackupFlag(peerID, folder, path string) bool {
        key := peerID + "|" + folder + "|" + path
        a.passiveMu.Lock()
        defer a.passiveMu.Unlock()
        v, ok := a.backupReq[key]
        delete(a.backupReq, key)
        return ok && v
}

// touchPassive creates/updates the passive-side transfer record.
func (a *Agent) touchPassive(peerID, folderName, path string, bytes int64, direction string) {
        if peerID == "" {
                return
        }
        folder, ok, _ := a.DB.FolderByName(folderName)
        if !ok {
                return
        }
        key := peerID + "|" + folderName + "|" + path
        a.passiveMu.Lock()
        pt, has := a.passive[key]
        now := time.Now()
        if !has {
                id := newTransferID()
                chunkSize := a.LiveConfig().ChunkSizeBytes
                size := int64(0)
                t := store.Transfer{
                        ID: id, PeerID: peerID, FolderID: folder.ID, RelPath: path,
                        Direction: direction, Size: size, Transferred: 0,
                        Status: transfer.StatusTransferring, ChunkSize: chunkSize,
                        CreatedAt: now.Unix(), StartedAt: now.Unix(),
                }
                _ = a.DB.PutTransfer(t)
                pt = passiveTransfer{id: id, direction: direction, lastUpdate: now}
                a.passive[key] = pt
        }
        t, ok2, _ := a.DB.GetTransfer(pt.id)
        if ok2 {
                t.Transferred += bytes
                t.Status = transfer.StatusTransferring
                _ = a.DB.PutTransfer(t)
        }
        pt.lastUpdate = now
        a.passiveMu.Unlock()
}

// finalizePassive completes a passive transfer record.
func (a *Agent) finalizePassive(c *netproto.Conn, fe *netproto.FileEnd) {
        peerID := c.RemoteInfo().PeerID
        key := peerID + "|" + fe.Folder + "|" + fe.Path
        a.passiveMu.Lock()
        pt, has := a.passive[key]
        if !has {
                a.passiveMu.Unlock()
                return
        }
        delete(a.passive, key)
        a.passiveMu.Unlock()
        t, ok, _ := a.DB.GetTransfer(pt.id)
        if !ok {
                return
        }
        if fe.OK {
                t.Status = transfer.StatusCompleted
                t.CompletedAt = time.Now().Unix()
                t.Error = ""
        } else {
                t.Status = transfer.StatusFailed
                t.Error = fe.Error
                t.CompletedAt = time.Now().Unix()
        }
        _ = a.DB.PutTransfer(t)
        a.broadcast("transfer", &transfer.Transfer{Transfer: t})
}

func (a *Agent) OnDelete(c *netproto.Conn, d *netproto.DeleteFile) error {
        folder, ok, err := a.DB.FolderByName(d.Folder)
        if err != nil || !ok {
                return fmt.Errorf("folder %s is not shared on this device", d.Folder)
        }
        abs, err := indexer.SafeJoin(folder.Path, d.Path)
        if err != nil {
                return err
        }
        st, err := os.Stat(abs)
        if os.IsNotExist(err) {
                return nil // already gone
        }
        if err != nil {
                return err
        }
        // safety: only delete when our content still matches what the sender
        // planned to delete — never clobber diverged data
        if d.ExpectedHash != "" && st.Size() >= 0 {
                h, _, err := native.HashGo(abs)
                if err != nil {
                        return err
                }
                if h != d.ExpectedHash {
                        return fmt.Errorf("refusing deletion: content changed since the plan")
                }
        }
        if err := a.Engine.TrashExisting(folder, d.Path); err != nil {
                return err
        }
        prev, had, _ := a.DB.GetFile(folder.ID, d.Path)
        s := ""
        if had {
                s = prev.LastSyncedHash
        }
        _ = a.DB.PutFile(store.FileEntry{
                FolderID: folder.ID, RelPath: d.Path, Deleted: true,
                LastSyncedHash: s, UpdatedAt: time.Now().Unix(),
        })
        a.Bus.Emit("FILE_DELETED", "INFO", fmt.Sprintf("Deleted %s/%s (remote deletion)", d.Folder, d.Path),
                map[string]any{"folder": d.Folder, "path": d.Path})
        return nil
}

func (a *Agent) OnAdopt(c *netproto.Conn, ad *netproto.Adopt) error {
        folder, ok, err := a.DB.FolderByName(ad.Folder)
        if err != nil || !ok {
                return fmt.Errorf("folder %s is not shared here", ad.Folder)
        }
        entry, has, _ := a.DB.GetFile(folder.ID, ad.Path)
        if !has || entry.Deleted {
                return nil
        }
        abs, err := indexer.SafeJoin(folder.Path, ad.Path)
        if err != nil {
                return err
        }
        if st, err := os.Stat(abs); err == nil && st.Size() == entry.Size {
                if entry.Hash == ad.Hash || entry.Hash == "" {
                        return a.DB.SetFileSynced(folder.ID, ad.Path, ad.Hash)
                }
        }
        return nil // stale adopt — ignore
}

func (a *Agent) OnConflictNotify(c *netproto.Conn, n *netproto.ConflictNotify) error {
        return a.Engine.MirrorConflict(n.Folder, n)
}

func (a *Agent) OnSyncBegin(c *netproto.Conn, s *netproto.SyncBegin, senderManifest *netproto.Index) error {
        peerID := c.RemoteInfo().PeerID
        if peerID == "" {
                return fmt.Errorf("unknown sender")
        }
        return a.DB.ReplaceRemoteManifest(peerID, s.Folder, manifestEntries(peerID, s.Folder, senderManifest))
}

func (a *Agent) OnSyncEnd(c *netproto.Conn, s *netproto.SyncEnd) error { return nil }

func (a *Agent) OnFileBegin(c *netproto.Conn, f *netproto.FileBegin) error {
        if _, ok, _ := a.DB.FolderByName(f.Folder); !ok {
                return fmt.Errorf("folder %s is not shared on this device", f.Folder)
        }
        if f.Backup {
                key := c.RemoteInfo().PeerID + "|" + f.Folder + "|" + f.Path
                a.passiveMu.Lock()
                a.backupReq[key] = true
                a.passiveMu.Unlock()
        }
        return nil
}

func (a *Agent) OnFileEnd(c *netproto.Conn, f *netproto.FileEnd) error {
        a.finalizePassive(c, f)
        return nil
}

func (a *Agent) OnProgress(c *netproto.Conn, p *netproto.TransferProgress) error {
        peerID := c.RemoteInfo().PeerID
        key := peerID + "|" + p.Folder + "|" + p.Path
        a.passiveMu.Lock()
        pt, has := a.passive[key]
        a.passiveMu.Unlock()
        if !has {
                return nil
        }
        t, ok, _ := a.DB.GetTransfer(pt.id)
        if ok {
                t.Transferred = p.Transferred
                _ = a.DB.PutTransfer(t)
        }
        return nil
}

// ManifestFor serves our index for a folder (IndexProvider).
func (a *Agent) ManifestFor(folderName string) (*netproto.Index, error) {
        folder, ok, err := a.DB.FolderByName(folderName)
        if err != nil || !ok {
                return nil, fmt.Errorf("folder %s is not shared on this device", folderName)
        }
        files, err := a.DB.ListFiles(folder.ID)
        if err != nil {
                return nil, err
        }
        idx := &netproto.Index{Folder: folderName, Files: []netproto.ManifestEntry{}}
        for _, f := range files {
                idx.Files = append(idx.Files, netproto.ManifestEntry{
                        Path: f.RelPath, Size: f.Size, Mtime: f.Mtime,
                        Hash: f.Hash, Deleted: f.Deleted, LastSyncedHash: f.LastSyncedHash,
                })
        }
        return idx, nil
}

func manifestEntries(peerID, folderName string, idx *netproto.Index) []store.RemoteEntry {
        out := []store.RemoteEntry{}
        if idx == nil {
                return out
        }
        for _, f := range idx.Files {
                out = append(out, store.RemoteEntry{
                        PeerID: peerID, FolderName: folderName, RelPath: f.Path,
                        Hash: f.Hash, Size: f.Size, Mtime: f.Mtime, Deleted: f.Deleted, SeenAt: time.Now().Unix(),
                })
        }
        return out
}

func platform() string {
        return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}
