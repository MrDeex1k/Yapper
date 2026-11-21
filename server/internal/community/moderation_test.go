package community

import (
	"context"
	"errors"
	"net/netip"
	"testing"
)

func TestModerationRolesAndSharedIP(t *testing.T) {
	s, owner := configuredStore(t)
	ctx := t.Context()
	ip := netip.MustParseAddr("192.0.2.9")
	otherIP := netip.MustParseAddr("2001:db8::1")
	if err := s.SetOpenAdmission(ctx, owner.ID, true); err != nil {
		t.Fatal(err)
	}
	target, targetKey, err := s.Guest(ctx, "target", "", ip)
	if err != nil {
		t.Fatal(err)
	}
	neighbor, neighborKey, err := s.Guest(ctx, "neighbor", "", ip)
	if err != nil {
		t.Fatal(err)
	}
	// Upgrade a database with existing account and guest identities.
	if _, err := s.Pool.Exec(ctx, `DROP TABLE moderation_audit,ip_blocks;
		ALTER TABLE participants DROP COLUMN kick_generation, DROP COLUMN mic_muted, DROP COLUMN last_ip;
		ALTER TABLE media_sessions DROP COLUMN client_ip`); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	restored, err := s.GuestIdentity(ctx, targetKey, ip)
	if err != nil || restored.ID != target.ID || restored.MicMuted || restored.KickGeneration != 0 {
		t.Fatalf("guest after migration: %+v %v", restored, err)
	}
	provision := func(context.Context) (string, error) { return "staff-subject", nil }
	if err := s.ProvisionModerator(ctx, target.ID, "staff", func(context.Context) (string, error) {
		t.Fatal("unauthorized actor reached AUTH")
		return "", nil
	}); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest provision: %v", err)
	}
	if err := s.ProvisionModerator(ctx, owner.ID, "staff", provision); err != nil {
		t.Fatal(err)
	}
	mod, err := s.AccountIdentity(ctx, "staff-subject")
	if err != nil || mod.Role != "moderator" {
		t.Fatalf("moderator binding: %+v %v", mod, err)
	}
	if _, err := s.Moderate(ctx, mod.ID, owner.ID, Ban, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("moderator targeted owner: %v", err)
	}
	if _, err := s.Moderate(ctx, mod.ID, target.ID, GrantModerator, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("moderator assigned a role: %v", err)
	}
	if _, err := s.Moderate(ctx, owner.ID, target.ID, GrantModerator, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("guest promoted without account: %v", err)
	}
	catalog, err := s.Catalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var voice string
	for _, channel := range catalog.Channels {
		if channel.Kind == "voice" {
			voice = channel.ID
		}
	}
	remove := func(context.Context, MediaSession) error { return nil }
	session, err := s.StartVoice(ctx, neighbor, voice, "", "", "", ip, remove)
	if err != nil {
		t.Fatal(err)
	}
	revoked, err := s.Moderate(ctx, mod.ID, target.ID, Ban, true)
	if err != nil || len(revoked) != 1 || revoked[0].Identity != session.Identity {
		t.Fatalf("shared IP voice revocation: %+v %v", revoked, err)
	}
	if _, err := s.VoiceSession(ctx, session.Identity); !errors.Is(err, ErrDenied) {
		t.Fatalf("blocked IP could retain its grant: %v", err)
	}
	if _, err := s.GuestIdentity(ctx, neighborKey, ip); !errors.Is(err, ErrIPBlocked) {
		t.Fatalf("shared IP accepted credential: %v", err)
	}
	if _, _, err := s.Guest(ctx, "new", "", ip); !errors.Is(err, ErrIPBlocked) {
		t.Fatalf("shared IP admitted fresh guest: %v", err)
	}
	if still, err := s.GuestIdentity(ctx, neighborKey, otherIP); err != nil || still.ID != neighbor.ID {
		t.Fatalf("unbanned identity at another address: %v", err)
	}
	if _, err := s.GuestIdentity(ctx, targetKey, otherIP); !errors.Is(err, ErrBanned) {
		t.Fatalf("identity ban did not follow guest: %v", err)
	}
	if _, err := s.Moderate(ctx, owner.ID, mod.ID, RevokeModerator, false); err != nil {
		t.Fatal(err)
	}
	if err := s.ProvisionModerator(ctx, owner.ID, "staff", provision); err != nil {
		t.Fatal(err)
	}
	after, err := s.AccountIdentity(ctx, "staff-subject")
	if err != nil || after.ID != mod.ID || after.Role != "participant" {
		t.Fatalf("retry granted revoked role: %+v %v", after, err)
	}
	if _, err := s.Moderate(ctx, mod.ID, target.ID, Unban, false); !errors.Is(err, ErrDenied) {
		t.Fatalf("demoted account moderated using an existing identity: %v", err)
	}
	if _, err := s.Moderate(ctx, owner.ID, target.ID, Unban, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GuestIdentity(ctx, targetKey, ip); err != nil {
		t.Fatalf("unban did not remove associated IP block: %v", err)
	}
	audit, err := s.Audit(ctx, owner.ID)
	if err != nil || len(audit) != 4 || audit[2].Action != "ban" || !audit[2].IPBlocked || audit[2].TargetID != target.ID || audit[2].ActorID != mod.ID {
		t.Fatalf("audit trail: %+v %v", audit, err)
	}
}
