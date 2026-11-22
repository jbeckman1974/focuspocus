#!/bin/sh
# Read on stdin by the checkout's VM launcher, after logging in with its Lima key.
set -eu

fail() { printf '%s\n' "$*" >&2; exit 1; }

. /etc/os-release
[ "$ID" = opensuse-tumbleweed ] || fail "Expected openSUSE Tumbleweed, found $ID"
[ -n "${VERSION_ID:-}" ] || fail 'Tumbleweed snapshot identifier is missing'
[ "$(uname -m)" = x86_64 ] || fail 'Expected an x86_64 guest kernel'
case "${SUDO_USER:-}" in
    ''|root|*[!a-zA-Z0-9._-]*) fail 'Run through the Lima user and sudo -n' ;;
esac

case "$1" in
    setup)
        install -d -m 0755 /etc/ssh/sshd_config.d
        cat > /etc/ssh/sshd_config.d/00-focuspocus.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
AllowUsers $SUDO_USER
EOF
        /usr/sbin/sshd -t
        if systemctl is-active --quiet sshd.service; then
            systemctl reload sshd.service
        fi
        if ! rpm -q docker docker-compose >/dev/null; then
            zypper --non-interactive refresh
            zypper --non-interactive install --no-recommends docker docker-compose
        fi
        systemctl enable --now docker.service
        exit 0
        ;;
    verify) ;;
    *) fail "Unexpected guest action $1" ;;
esac

policy=$(/usr/sbin/sshd -T -C "user=$SUDO_USER,host=localhost,addr=127.0.0.1")
for setting in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' \
        'authenticationmethods publickey' "allowusers $SUDO_USER"; do
    printf '%s\n' "$policy" | grep -Fqx "$setting" || fail "Missing SSH policy: $setting"
done
systemctl is-active --quiet docker.service || fail 'Docker service is inactive'
platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
[ "$platform" = linux/amd64 ] || fail "Expected Docker linux/amd64, found $platform"
printf 'Guest: %s (snapshot %s), kernel %s %s, Docker %s\n' \
    "$PRETTY_NAME" "$VERSION_ID" "$(uname -r)" "$(uname -m)" "$platform"
docker version --format 'Docker Engine {{.Server.Version}}'
docker compose version
