package identity

import (
	"context"
	"net/netip"
)

type addressKey struct{}

func WithClientAddress(ctx context.Context, address netip.Addr) context.Context {
	return context.WithValue(ctx, addressKey{}, address)
}

func ClientAddress(ctx context.Context) netip.Addr {
	address, _ := ctx.Value(addressKey{}).(netip.Addr)
	return address
}
