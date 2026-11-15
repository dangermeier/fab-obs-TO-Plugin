const os = require('os');

// Hyper-V, WSL, Docker and VPN adapters: look real, unreachable for a tablet.
const VIRTUAL = /vethernet|virtualbox|hyper-?v|vmware|wsl|docker|tailscale|zerotier|tap-|openvpn/i;

// Addresses a tablet can reach, most likely first. In a container only the
// bridge (172.17.x) shows up, so PUBLIC_HOST replaces the list when set.
function lanAddresses(port = process.env.PORT || 3000) {
  const override = (process.env.PUBLIC_HOST || '').trim();
  if (override) {
    // "192.168.2.10", "fab.local" or a full "http://host:1234"
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
      if (ni.address.startsWith('169.254.')) continue;   // link-local
      out.push({
        name,
        address: ni.address,
        url: `http://${ni.address}:${port}/control/`,
        virtual: VIRTUAL.test(name)
      });
    }
  }

  // real adapters first, typical Wi-Fi ranges on top
  const rank = e => (e.virtual ? 4
    : e.address.startsWith('192.168.') ? 0
    : e.address.startsWith('10.')      ? 1 : 2);

  return out.sort((a, b) => rank(a) - rank(b));
}

// In a container without PUBLIC_HOST the addresses above are useless to a tablet.
function needsPublicHost() {
  if (process.env.PUBLIC_HOST) return false;
  return !!process.env.FAB_IN_CONTAINER;
}

module.exports = { lanAddresses, needsPublicHost };
