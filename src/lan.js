const os = require('os');

// Hyper-V, WSL, Docker and VPN adapters all look like real networks but no
// tablet can reach the server through them.
const VIRTUAL = /vethernet|virtualbox|hyper-?v|vmware|wsl|docker|tailscale|zerotier|tap-|openvpn/i;

/* Addresses a tablet on the same network can actually reach, each labelled with
 * its adapter name so the operator can tell the Wi-Fi from the virtual ones.
 * Most likely candidate first.
 *
 * Inside a container the only interface is the bridge (172.17.x), which is
 * useless to a tablet — set PUBLIC_HOST to the host's LAN address or hostname
 * and that is advertised verbatim instead.
 */
function lanAddresses(port = process.env.PORT || 3000) {
  const override = (process.env.PUBLIC_HOST || '').trim();
  if (override) {
    // Accept "192.168.2.10", "fab.local" or a full "http://host:1234".
    const url = /^https?:\/\//.test(override)
      ? override.replace(/\/+$/, '')
      : `http://${override}${override.includes(':') ? '' : ':' + port}`;
    return [{ name: 'PUBLIC_HOST', address: override, url: `${url}/control/`, virtual: false }];
  }

  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' && ni.family !== 4) continue;
      if (ni.internal) continue;
      if (ni.address.startsWith('169.254.')) continue;   // link-local, never routable
      out.push({
        name,
        address: ni.address,
        url: `http://${ni.address}:${port}/control/`,
        virtual: VIRTUAL.test(name)
      });
    }
  }

  // Real adapters first, and within those the usual home/venue Wi-Fi ranges.
  const rank = e => (e.virtual ? 4
    : e.address.startsWith('192.168.') ? 0
    : e.address.startsWith('10.')      ? 1 : 2);

  return out.sort((a, b) => rank(a) - rank(b));
}

// True when the addresses above are guesswork from container interfaces rather
// than something a tablet can reach.
function needsPublicHost() {
  if (process.env.PUBLIC_HOST) return false;
  return !!process.env.FAB_IN_CONTAINER;
}

module.exports = { lanAddresses, needsPublicHost };
