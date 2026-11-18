# XRPL NFT Collection Snapshot

Client-side tool for XRPL NFT collection snapshots.

Look up by issuer and taxon, or paste an NFT ID to resolve the collection. Fetch holders from a public Clio node, then view the summary and download the data. Runs entirely in the browser. No backend.

**Live:** [https://handy4ndy.github.io/nft-data/](https://handy4ndy.github.io/nft-data/)

Provided by [xrpdev.net](https://xrpdev.net).

## Features

- Lookup modes: **Issuer** (issuer + optional taxon) or **NFT ID** (`nft_info` resolves the collection, then snapshots it)
- Holder snapshot via `nfts_by_issuer`
- Collection name lookup from NFT metadata when available
- Summary: total NFTs, unique holders, held by issuer
- Downloads: holders JSON, holders TXT, raw NFTs JSON
- Clio endpoint failover across `s2`, `s1`, and `honeycluster`
- Cancel mid-fetch
- Mobile-friendly layout

## Project layout

```
nft-data/
├── index.html          # page + SEO / Open Graph / JSON-LD
├── css/style.css       # layout and theme
├── js/app.js           # Clio fetch, aggregation, downloads
├── assets/             # favicon, hero mark, OG image
├── site.webmanifest
├── robots.txt
├── sitemap.xml
└── README.md
```

## Local preview

```bash
npx --yes serve . -p 4173
```

Open `http://localhost:4173`.

Sample UI without a network fetch:

```
http://localhost:4173/?demo=1
```

## GitHub Pages

1. Push to GitHub (`handy4ndy/nft-data` or your fork)
2. Settings → Pages → Deploy from a branch
3. Branch: `main`, folder: `/ (root)`
4. Site URL: `https://handy4ndy.github.io/nft-data/`

`.nojekyll` is included so GitHub Pages serves the static files as-is.

## Clio endpoints

`nfts_by_issuer` is Clio-only. The tool uses:

- `wss://s2.ripple.com`
- `wss://s1.ripple.com`
- `wss://honeycluster.io`

If the selected endpoint fails, it tries the others automatically.

## Lookup modes

Use the toggle next to **Lookup**:

| Mode | Fields | Behavior |
|------|--------|----------|
| Issuer | Issuer address, taxon, Clio endpoint | Snapshots holders for that issuer (+ taxon filter if set) |
| NFT ID | NFTokenID, Clio endpoint | Calls `nft_info`, reads issuer + taxon, then runs the same collection snapshot |

## Defaults

Issuer mode prefills the XRPL Cards collection:

| Field  | Value                                  |
|--------|----------------------------------------|
| Issuer | `rpy293Hv6Z4PzZzmAbNeWaiPEfNjMkthGU` |
| Taxon  | `1`                                    |

## Notes

- Large collections take time in the browser. Use Cancel if you need to stop.
- Collection names depend on public NFT metadata / IPFS gateways. If lookup fails, Issuer and Taxon still show.
- Public Clio nodes can rate-limit. Failover covers most of that.
- NFT ID must be a 64-character hex NFTokenID.
