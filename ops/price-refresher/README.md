# Testnet price refresher (DigitalOcean)

_DECISIONS D26. Maintained by Claude._

The public testnet demo reads four mock prices. Two are for the v2 swap venue (mWOKB, mUSDC) and two for the v1 market (MockCollateral, MockDebt). Each expires after **24 hours**. Once expired, swaps are refused with `QuoteExpired` and new borrows are denied.

`refresh.mjs` keeps them fresh. Every 6 hours it checks their age; any price older than 12 hours is re-set to the **same value already on chain**.

## Scope of the script
- It runs on X Layer testnet 1952 only. Mainnet is impossible: it refuses any other chain ID, and the key is testnet-only.
- It calls only `setPrice(asset, <current on-chain price>)` on the two pinned oracles, for the four pinned assets.
- It refuses if the key isn't the oracle owner `0x8C17…5D67`, if an oracle's owner changed, if a price is zero, or if gas is above 1 gwei.
- Each refresh costs about 0.000001 test OKB. The deployer holds about 0.19 test OKB, which lasts for years.

**Why the server holds the deployer key.** The oracles' owner is immutable, so a narrower key isn't possible. The deployer also owns the other testnet demo contracts. If the server were compromised, someone could disrupt the **testnet** demo, but they could not touch mainnet or any real funds. Keep the server minimal: SSH-key login only and nothing else running.

## One-time setup on a fresh Ubuntu droplet (founder)
Run as root on the droplet:

```sh
apt-get update && apt-get install -y nodejs npm      # needs Node >= 20; otherwise install Node 22 from NodeSource
useradd --system --create-home --home-dir /opt/peridot-refresher --shell /usr/sbin/nologin peridot
mkdir -p /etc/peridot && chmod 700 /etc/peridot
```

From your Mac, in the repository root, copy the two files over:

```sh
scp ops/price-refresher/refresh.mjs ops/price-refresher/package.json root@<droplet-ip>:/opt/peridot-refresher/
```

Back on the droplet, as root:

```sh
cd /opt/peridot-refresher && npm install --omit=dev && chown -R peridot:peridot /opt/peridot-refresher
( umask 077 && : > /etc/peridot/deployer.key ) && nano /etc/peridot/deployer.key
#   paste the TESTNET deployer key (the contents of $PERIDOT_KEY_DIR/deployer.key on your Mac), save
chown peridot:peridot /etc/peridot/deployer.key && chmod 600 /etc/peridot/deployer.key
chown peridot:peridot /etc/peridot && chmod 700 /etc/peridot
```

Install the service and timer, still as root:

```sh
cat > /etc/systemd/system/peridot-refresher.service <<'EOF'
[Unit]
Description=Peridot testnet mock-price refresher (chain 1952)
After=network-online.target
[Service]
Type=oneshot
User=peridot
WorkingDirectory=/opt/peridot-refresher
Environment=PERIDOT_TESTNET_KEY_FILE=/etc/peridot/deployer.key
ExecStart=/usr/bin/node /opt/peridot-refresher/refresh.mjs
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
EOF
cat > /etc/systemd/system/peridot-refresher.timer <<'EOF'
[Unit]
Description=Run the Peridot testnet price refresher every 6 hours
[Timer]
OnBootSec=2min
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now peridot-refresher.timer
systemctl start peridot-refresher.service && journalctl -u peridot-refresher -n 20 --no-pager
```

The last command should print four lines with ages. Any price that was due also prints a "refreshed … tx 0x…" line.

## Checking it
- **From anywhere, read-only:** `node ops/price-refresher/refresh.mjs --check`. This needs no key and prints each price's age.
- **On the droplet:**
  - `systemctl list-timers peridot-refresher.timer` shows the next run.
  - `journalctl -u peridot-refresher` shows the history. Only transaction hashes are logged, never the key.
- **Turning it off after judging:** `systemctl disable --now peridot-refresher.timer`. Then delete `/etc/peridot/deployer.key`, or destroy the droplet.
