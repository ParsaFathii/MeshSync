package transfer

import (
	"sync"
	"time"
)

// Bandwidth is a global token bucket shared by every active transfer. With
// rate == 0 it is unlimited. Wait(n) blocks until n bytes worth of tokens
// are available, which applies the cap predictably at chunk granularity.
type Bandwidth struct {
	mu     sync.Mutex
	rate   int64 // bytes per second; 0 = unlimited
	tokens float64
	cap    float64
	last   time.Time
}

func NewBandwidth(rateBps int64) *Bandwidth {
	b := &Bandwidth{rate: rateBps, last: time.Now()}
	b.cap = burstFor(rateBps)
	b.tokens = b.cap
	return b
}

func burstFor(rate int64) float64 {
	if rate <= 0 {
		return 0
	}
	burst := float64(rate) // one second of burst
	if burst > 8*1024*1024 {
		burst = 8 * 1024 * 1024
	}
	return burst
}

// SetRate changes the limit live.
func (b *Bandwidth) SetRate(rateBps int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.rate = rateBps
	b.cap = burstFor(rateBps)
	if b.tokens > b.cap {
		b.tokens = b.cap
	}
}

func (b *Bandwidth) Rate() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.rate
}

// Wait blocks until n bytes can be transferred.
func (b *Bandwidth) Wait(n int64) {
	if n <= 0 {
		return
	}
	for {
		b.mu.Lock()
		if b.rate <= 0 {
			b.mu.Unlock()
			return
		}
		now := time.Now()
		b.tokens += now.Sub(b.last).Seconds() * float64(b.rate)
		b.last = now
		if b.tokens > b.cap {
			b.tokens = b.cap
		}
		if b.tokens >= float64(n) {
			b.tokens -= float64(n)
			b.mu.Unlock()
			return
		}
		need := (float64(n) - b.tokens) / float64(b.rate)
		b.mu.Unlock()
		if need > 0 {
			time.Sleep(time.Duration(need * float64(time.Second)))
		}
	}
}
