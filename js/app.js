(() => {
  const XRPL_CARDS = {
    issuer: 'rpy293Hv6Z4PzZzmAbNeWaiPEfNjMkthGU',
    taxon: '1'
  };

  const els = {
    form: document.getElementById('lookupForm'),
    issuer: document.getElementById('issuer'),
    taxon: document.getElementById('taxon'),
    nftId: document.getElementById('nftId'),
    endpoint: document.getElementById('endpoint'),
    fetchBtn: document.getElementById('fetchBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    presetBtn: document.getElementById('presetBtn'),
    modeIssuer: document.getElementById('modeIssuer'),
    taxonField: document.getElementById('taxonField'),
    modeNft: document.getElementById('modeNft'),
    modeButtons: Array.from(document.querySelectorAll('.mode-btn')),
    status: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    statusMeta: document.getElementById('statusMeta'),
    progressBar: document.getElementById('progressBar'),
    log: document.getElementById('log'),
    results: document.getElementById('results'),
    identity: document.getElementById('identity'),
    summary: document.getElementById('summary'),
    snapshotTime: document.getElementById('snapshotTime'),
    holdersTableBody: document.querySelector('#holdersTable tbody'),
    holdersNote: document.getElementById('holdersNote'),
    dlHoldersJson: document.getElementById('dlHoldersJson'),
    dlHoldersTxt: document.getElementById('dlHoldersTxt'),
    dlRawJson: document.getElementById('dlRawJson')
  };

  let cancelRequested = false;
  let lastSnapshot = null;
  let issuerTruncateObserver = null;
  let lookupMode = 'issuer';

  function decodeUri(hex) {
    if (!hex) return null;
    try {
      const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  }

  function setBusy(busy) {
    els.fetchBtn.disabled = busy;
    els.cancelBtn.hidden = !busy;
    els.issuer.disabled = busy;
    els.taxon.disabled = busy;
    els.nftId.disabled = busy;
    els.endpoint.disabled = busy;
    els.presetBtn.disabled = busy || lookupMode !== 'issuer';
    els.modeButtons.forEach((btn) => {
      btn.disabled = busy;
    });
  }

  function setLookupMode(mode) {
    lookupMode = mode === 'nft' ? 'nft' : 'issuer';
    const isNft = lookupMode === 'nft';

    els.modeIssuer.hidden = isNft;
    els.taxonField.hidden = isNft;
    els.modeNft.hidden = !isNft;
    els.presetBtn.hidden = isNft;

    els.modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === lookupMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function parseNftId(raw) {
    const value = String(raw || '').trim();
    if (!/^[0-9A-Fa-f]{64}$/.test(value)) {
      throw new Error('NFT ID must be a 64-character hex NFTokenID');
    }
    return value.toUpperCase();
  }

  async function resolveCollectionFromNft(nftId, preferredEndpoint) {
    const endpoints = endpointOrder(preferredEndpoint);
    const failures = [];

    for (let i = 0; i < endpoints.length; i += 1) {
      if (cancelRequested) throw new Error('Cancelled');
      const endpoint = endpoints[i];
      const client = new xrpl.Client(endpoint);

      try {
        setStatus('Resolving NFT...', endpoint);
        logLine(`Looking up NFT on ${endpoint}`);
        setProgress(4);
        await client.connect();

        const info = await client.request({
          command: 'nft_info',
          nft_id: nftId
        });

        const issuer = info.result?.issuer;
        const taxonRaw = info.result?.nft_taxon;
        if (!issuer || taxonRaw === undefined || taxonRaw === null) {
          throw new Error('nft_info did not return issuer and taxon');
        }

        const taxon = Number(taxonRaw);
        if (!Number.isInteger(taxon) || taxon < 0) {
          throw new Error('nft_info returned an invalid taxon');
        }

        logLine(`Resolved issuer ${issuer}, taxon ${taxon}`);
        if (els.endpoint.value !== endpoint) {
          els.endpoint.value = endpoint;
        }
        els.issuer.value = issuer;
        els.taxon.value = String(taxon);

        return { issuer, taxon, endpoint };
      } catch (err) {
        const message = errorMessage(err);
        failures.push(`${endpoint}: ${message}`);
        logLine(`NFT resolve failed on ${endpoint}: ${message}`);
        if (!shouldFailover(err)) throw err;
        const next = endpoints[i + 1];
        if (next) {
          logLine(`Trying fallback endpoint ${next}...`);
          setStatus('Retrying NFT lookup...', next);
        }
      } finally {
        try {
          if (client.isConnected()) await client.disconnect();
        } catch {
          // disconnect can fail if the socket already dropped
        }
      }
    }

    const detail = failures.length ? ` (${failures.join('; ')})` : '';
    throw new Error(`Could not resolve NFT ID${detail}`);
  }

  function showStatus() {
    els.status.hidden = false;
  }

  function setProgress(pct) {
    els.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function setStatus(text, meta = '') {
    els.statusText.textContent = text;
    els.statusMeta.textContent = meta;
  }

  function clearLog() {
    els.log.textContent = '';
  }

  function logLine(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    els.log.textContent += (els.log.textContent ? '\n' : '') + line;
    els.log.scrollTop = els.log.scrollHeight;
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function assertXrpl() {
    if (typeof xrpl === 'undefined' || !xrpl.Client) {
      throw new Error('xrpl library failed to load from CDN');
    }
  }

  function parseTaxon(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('Taxon must be a non-negative integer, or blank for all taxa');
    }
    return n;
  }

  async function fetchAllNfts(client, issuer, taxon) {
    const request = {
      command: 'nfts_by_issuer',
      issuer,
      limit: 400
    };
    if (taxon !== null) request.nft_taxon = taxon;

    const allNFTs = [];
    let marker;
    let pageCount = 0;

    do {
      if (cancelRequested) throw new Error('Cancelled');
      pageCount += 1;
      if (marker) request.marker = marker;

      const response = await client.request(request);
      const nfts = response.result.nfts || [];
      allNFTs.push(...nfts);
      marker = response.result.marker;

      logLine(`Page ${pageCount}: ${nfts.length} NFTs (total ${allNFTs.length})`);
      setStatus('Fetching NFTs by issuer...', `page ${pageCount}`);
      setProgress(Math.min(40, pageCount * 4));
    } while (marker);

    return allNFTs;
  }

  async function buildHolders(client, issuer, allNFTs) {
    const holderMap = new Map();
    let processed = 0;
    let errors = 0;
    let nftInfoLookups = 0;
    const start = Date.now();
    const missingOwner = allNFTs.filter((nft) => !nft.owner).length;

    if (missingOwner === 0) {
      logLine('Using owner from nfts_by_issuer (no nft_info lookups needed).');
    } else {
      logLine(`Owner missing on ${missingOwner} NFTs; falling back to nft_info.`);
    }

    for (const nft of allNFTs) {
      if (cancelRequested) throw new Error('Cancelled');
      processed += 1;

      try {
        let owner = nft.owner;
        if (!owner) {
          nftInfoLookups += 1;
          const info = await client.request({
            command: 'nft_info',
            nft_id: nft.nft_id
          });
          owner = info.result.owner;
        }

        if (!holderMap.has(owner)) holderMap.set(owner, []);
        holderMap.get(owner).push({
          NFTokenID: nft.nft_id,
          nft_serial: nft.nft_serial,
          uri: decodeUri(nft.uri),
          flags: nft.flags,
          transfer_fee: nft.transfer_fee
        });
      } catch (err) {
        errors += 1;
        if (errors <= 5) {
          logLine(`Error for ${nft.nft_id}: ${err.message || err}`);
        }
      }

      if (processed % 100 === 0 || processed === allNFTs.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const pct = 40 + (processed / Math.max(allNFTs.length, 1)) * 55;
        setProgress(pct);
        setStatus('Building holder map...', `${processed}/${allNFTs.length}`);
        logLine(`Processed ${processed}/${allNFTs.length} (${elapsed}s)`);
      }
    }

    logLine(`Done processing (${nftInfoLookups} nft_info lookups, ${errors} errors)`);
    return holderMap;
  }

  function toSnapshot(issuer, taxon, allNFTs, holderMap, collectionName = null) {
    const now = new Date();
    const holders = [];

    for (const [address, nfts] of holderMap.entries()) {
      holders.push({
        address,
        count: nfts.length,
        isIssuer: address === issuer,
        nfts
      });
    }

    holders.sort((a, b) => b.count - a.count);
    const externalHolders = holders.filter((h) => !h.isIssuer);
    const heldByIssuer = holderMap.get(issuer)?.length || 0;
    const snapshotId = stamp();

    const holdersPayload = {
      issuer,
      taxon,
      collectionName,
      totalNFTs: allNFTs.length,
      uniqueHolders: holders.length,
      heldByIssuer,
      heldByOthers: allNFTs.length - heldByIssuer,
      externalHolders: externalHolders.length,
      holders,
      timestamp: now.toISOString(),
      snapshotId
    };

    const rawPayload = {
      issuer,
      taxon,
      collectionName,
      total: allNFTs.length,
      nfts: allNFTs,
      timestamp: now.toISOString()
    };

    let simpleList = '';
    holders.forEach((holder) => {
      const label = holder.isIssuer ? ' (ISSUER)' : '';
      simpleList += `${holder.address}${label}: ${holder.count}\n`;
    });

    return { holdersPayload, rawPayload, simpleList, externalHolders };
  }

  const IPFS_GATEWAYS = [
    'https://gateway.pinata.cloud/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://dweb.link/ipfs/',
    'https://nftstorage.link/ipfs/'
  ];

  function ipfsPath(uri) {
    const trimmed = String(uri || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('ipfs://')) {
      return trimmed.replace(/^ipfs:\/\//, '').replace(/^ipfs\//, '');
    }
    if (trimmed.startsWith('Qm') || trimmed.startsWith('bafy')) return trimmed;
    return null;
  }

  function metadataUrls(uri) {
    const trimmed = String(uri || '').trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return [trimmed];
    }

    const path = ipfsPath(trimmed);
    if (!path) return [];
    return IPFS_GATEWAYS.map((gateway) => `${gateway}${path}`);
  }

  function pickCollectionName(meta) {
    if (!meta || typeof meta !== 'object') return null;

    const candidates = [
      meta.collection?.name,
      typeof meta.collection === 'string' ? meta.collection : null,
      meta.collection_name,
      meta.collectionName,
      meta.collection_info?.name,
      meta.project?.name,
      meta.series
    ];

    for (const value of candidates) {
      if (typeof value === 'string') {
        const cleaned = value.trim();
        if (cleaned) return cleaned;
      }
    }

    return null;
  }

  async function resolveCollectionName(allNFTs) {
    const withUri = allNFTs
      .map((nft) => decodeUri(nft.uri) || nft.uri)
      .filter((uri) => typeof uri === 'string' && uri.trim());

    const unique = [...new Set(withUri)].slice(0, 4);
    if (!unique.length) {
      logLine('No NFT URIs available for collection name lookup.');
      return null;
    }

    logLine('Checking metadata for collection name...');

    for (const uri of unique) {
      if (cancelRequested) return null;
      const urls = metadataUrls(uri);
      if (!urls.length) continue;

      for (const url of urls) {
        if (cancelRequested) return null;
        try {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 8000);
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json,text/plain,*/*' }
          });
          window.clearTimeout(timer);

          if (!response.ok) continue;

          const contentType = response.headers.get('content-type') || '';
          let meta;
          if (contentType.includes('json') || url.includes('.json')) {
            meta = await response.json();
          } else {
            const text = await response.text();
            meta = JSON.parse(text);
          }

          const name = pickCollectionName(meta);
          if (name) {
            logLine(`Collection name: ${name}`);
            return name;
          }
        } catch {
          // try next gateway / URI
        }
      }
    }

    logLine('Could not resolve a collection name from NFT metadata.');
    return null;
  }

  function formatNumber(n) {
    return Number(n).toLocaleString();
  }

  function formatSnapshotTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch {
      return iso;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function middleTruncate(value, maxChars) {
    const text = String(value || '');
    if (maxChars < 5 || text.length <= maxChars) return text;
    const budget = maxChars - 1;
    const head = Math.max(2, Math.ceil(budget * 0.55));
    const tail = Math.max(2, budget - head);
    return `${text.slice(0, head)}…${text.slice(-tail)}`;
  }

  function measureIssuerChars(el) {
    const width = el.clientWidth;
    if (width <= 0) return 8;
    const sample = '0';
    const canvas = measureIssuerChars._canvas || (measureIssuerChars._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(el);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const charWidth = ctx.measureText(sample).width || 8;
    return Math.max(8, Math.floor(width / charWidth));
  }

  function bindIssuerTruncate(fullAddress) {
    if (issuerTruncateObserver) {
      issuerTruncateObserver.disconnect();
      issuerTruncateObserver = null;
    }

    const valueEl = els.identity.querySelector('.identity-item.issuer .value');
    if (!valueEl) return;

    const apply = () => {
      const maxChars = measureIssuerChars(valueEl);
      valueEl.textContent = middleTruncate(fullAddress, maxChars);
    };

    apply();
    issuerTruncateObserver = new ResizeObserver(() => apply());
    issuerTruncateObserver.observe(valueEl);
  }

  function renderSummary(payload) {
    const taxonLabel = payload.taxon === null ? 'all' : String(payload.taxon);
    els.snapshotTime.textContent = formatSnapshotTime(payload.timestamp);

    const hasCollection = Boolean(payload.collectionName);
    const collectionBlock = hasCollection
      ? `<div class="identity-item collection">
          <span class="label">Collection</span>
          <span class="value value-strong">${escapeHtml(payload.collectionName)}</span>
        </div>`
      : '';

    els.identity.innerHTML = `
      <div class="identity-grid${hasCollection ? ' has-collection' : ''}">
        ${collectionBlock}
        <div class="identity-item issuer">
          <span class="label">Issuer</span>
          <span class="value" title="${escapeHtml(payload.issuer)}">${escapeHtml(payload.issuer)}</span>
        </div>
        <div class="identity-item taxon">
          <span class="label">Taxon</span>
          <span class="value value-strong">${escapeHtml(taxonLabel)}</span>
        </div>
      </div>
    `;

    bindIssuerTruncate(payload.issuer);

    const kpis = [
      ['Total NFTs', formatNumber(payload.totalNFTs)],
      ['Unique holders', formatNumber(payload.uniqueHolders)],
      ['Held by issuer', formatNumber(payload.heldByIssuer)]
    ];

    els.summary.innerHTML = kpis
      .map(
        ([label, value]) => `
      <div class="kpi">
        <span class="label">${label}</span>
        <span class="value">${value}</span>
      </div>`
      )
      .join('');
  }

  function renderTable(holders, limit = 50) {
    const rows = holders.slice(0, limit);
    els.holdersTableBody.innerHTML = rows
      .map((holder, i) => {
        const badge = holder.isIssuer ? '<span class="badge">ISSUER</span>' : '';
        return `
        <tr>
          <td>${i + 1}</td>
          <td>
            <div class="addr-cell">
              <span class="mono">${escapeHtml(holder.address)}</span>
              ${badge}
            </div>
          </td>
          <td class="num">${formatNumber(holder.count)}</td>
        </tr>`;
      })
      .join('');

    if (holders.length > limit) {
      els.holdersNote.textContent = `Showing top ${limit} of ${formatNumber(holders.length)} holders. Download for the full list.`;
    } else {
      els.holdersNote.textContent = `Showing all ${formatNumber(holders.length)} holders, sorted by count.`;
    }
  }

  function endpointOrder(preferred) {
    const all = Array.from(els.endpoint.options).map((opt) => opt.value);
    return [preferred, ...all.filter((url) => url !== preferred)];
  }

  function errorMessage(err) {
    return err?.data?.error_message || err?.data?.error || err?.message || String(err);
  }

  function shouldFailover(err) {
    if (cancelRequested) return false;
    const message = errorMessage(err);
    if (message === 'Cancelled') return false;
    return true;
  }

  async function runOnEndpoint(issuer, taxon, endpoint) {
    setStatus('Connecting...', endpoint);
    logLine(`Connecting to ${endpoint}`);
    setProgress(2);

    const client = new xrpl.Client(endpoint);

    try {
      await client.connect();
      logLine(`Connected to ${endpoint}`);
      setProgress(8);

      logLine(`Issuer: ${issuer}`);
      logLine(taxon === null ? 'Taxon: all' : `Taxon: ${taxon}`);

      const allNFTs = await fetchAllNfts(client, issuer, taxon);
      logLine(`Total NFTs found: ${allNFTs.length}`);

      if (allNFTs.length === 0) {
        setStatus('No NFTs found', endpoint);
        setProgress(100);
        logLine('Nothing to aggregate.');
        return { empty: true };
      }

      const holderMap = await buildHolders(client, issuer, allNFTs);

      setStatus('Resolving collection name...', endpoint);
      const collectionName = await resolveCollectionName(allNFTs);

      const snapshot = toSnapshot(issuer, taxon, allNFTs, holderMap, collectionName);
      lastSnapshot = snapshot;

      renderSummary(snapshot.holdersPayload);
      renderTable(snapshot.holdersPayload.holders);
      els.results.hidden = false;

      setProgress(100);
      setStatus('Complete', `${snapshot.holdersPayload.totalNFTs} NFTs`);
      logLine(`Snapshot ready via ${endpoint}. Use the download buttons above.`);
      return { ok: true };
    } finally {
      try {
        if (client.isConnected()) await client.disconnect();
      } catch {
        // disconnect can fail if the socket already dropped
      }
    }
  }

  async function runLookup(issuer, taxon, preferredEndpoint, nftId = null) {
    assertXrpl();
    cancelRequested = false;
    lastSnapshot = null;
    els.results.hidden = true;
    els.statusText.classList.remove('error-text');
    showStatus();
    clearLog();
    setBusy(true);

    try {
      let resolvedIssuer = issuer;
      let resolvedTaxon = taxon;
      let startEndpoint = preferredEndpoint;

      if (nftId) {
        logLine(`NFT ID: ${nftId}`);
        const resolved = await resolveCollectionFromNft(nftId, preferredEndpoint);
        resolvedIssuer = resolved.issuer;
        resolvedTaxon = resolved.taxon;
        startEndpoint = resolved.endpoint;
        setProgress(6);
      }

      const endpoints = endpointOrder(startEndpoint);
      const failures = [];

      for (let i = 0; i < endpoints.length; i += 1) {
        if (cancelRequested) throw new Error('Cancelled');
        const endpoint = endpoints[i];

        try {
          const result = await runOnEndpoint(resolvedIssuer, resolvedTaxon, endpoint);
          if (result?.ok || result?.empty) {
            if (els.endpoint.value !== endpoint) {
              els.endpoint.value = endpoint;
              logLine(`Switched active endpoint to ${endpoint}`);
            }
            return;
          }
        } catch (err) {
          const message = errorMessage(err);
          failures.push(`${endpoint}: ${message}`);
          logLine(`Error on ${endpoint}: ${message}`);

          if (!shouldFailover(err)) throw err;

          const next = endpoints[i + 1];
          if (!next) break;

          logLine(`Trying fallback endpoint ${next}...`);
          setStatus('Retrying...', next);
          setProgress(2);
        }
      }

      setStatus('Failed', '');
      els.statusText.classList.add('error-text');
      logLine('All Clio endpoints failed.');
      failures.forEach((line) => logLine(`  ${line}`));
    } catch (err) {
      const message = errorMessage(err);
      setStatus(message === 'Cancelled' ? 'Cancelled' : 'Failed', '');
      if (message !== 'Cancelled') els.statusText.classList.add('error-text');
      logLine(`Error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  els.modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setLookupMode(btn.dataset.mode);
    });
  });

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      if (lookupMode === 'nft') {
        const nftId = parseNftId(els.nftId.value);
        runLookup(null, null, els.endpoint.value, nftId);
        return;
      }

      const issuer = els.issuer.value.trim();
      if (!issuer) throw new Error('Issuer is required');
      const taxon = parseTaxon(els.taxon.value);
      runLookup(issuer, taxon, els.endpoint.value);
    } catch (err) {
      showStatus();
      clearLog();
      setStatus('Invalid input', '');
      logLine(err.message || String(err));
    }
  });

  els.cancelBtn.addEventListener('click', () => {
    cancelRequested = true;
    logLine('Cancel requested...');
    setStatus('Cancelling...', '');
  });

  els.presetBtn.addEventListener('click', () => {
    els.issuer.value = XRPL_CARDS.issuer;
    els.taxon.value = XRPL_CARDS.taxon;
  });

  els.dlHoldersJson.addEventListener('click', () => {
    if (!lastSnapshot) return;
    const id = lastSnapshot.holdersPayload.snapshotId;
    downloadBlob(
      `nft-holders-${id}.json`,
      JSON.stringify(lastSnapshot.holdersPayload, null, 2),
      'application/json'
    );
  });

  els.dlHoldersTxt.addEventListener('click', () => {
    if (!lastSnapshot) return;
    const id = lastSnapshot.holdersPayload.snapshotId;
    downloadBlob(`nft-holders-${id}.txt`, lastSnapshot.simpleList, 'text/plain');
  });

  els.dlRawJson.addEventListener('click', () => {
    if (!lastSnapshot) return;
    const id = lastSnapshot.holdersPayload.snapshotId;
    downloadBlob(
      `nft-raw-${id}.json`,
      JSON.stringify(lastSnapshot.rawPayload, null, 2),
      'application/json'
    );
  });

  setLookupMode('issuer');

  // ?demo=1 loads sample results without hitting the network
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    const demoPayload = {
      issuer: XRPL_CARDS.issuer,
      taxon: 1,
      collectionName: 'XRPL Cards',
      totalNFTs: 6169,
      uniqueHolders: 248,
      heldByIssuer: 24,
      heldByOthers: 6145,
      externalHolders: 247,
      holders: [
        { address: 'rDemoHolder11111111111111111111111', count: 180, isIssuer: false, nfts: [] },
        { address: 'rDemoHolder22222222222222222222222', count: 95, isIssuer: false, nfts: [] },
        { address: 'rDemoHolder33333333333333333333333', count: 42, isIssuer: false, nfts: [] },
        { address: XRPL_CARDS.issuer, count: 24, isIssuer: true, nfts: [] }
      ],
      timestamp: new Date().toISOString(),
      snapshotId: stamp()
    };
    lastSnapshot = {
      holdersPayload: demoPayload,
      rawPayload: {
        issuer: demoPayload.issuer,
        taxon: 1,
        collectionName: demoPayload.collectionName,
        total: 6169,
        nfts: [],
        timestamp: demoPayload.timestamp
      },
      simpleList: demoPayload.holders.map((h) => `${h.address}${h.isIssuer ? ' (ISSUER)' : ''}: ${h.count}`).join('\n') + '\n',
      externalHolders: demoPayload.holders.filter((h) => !h.isIssuer)
    };
    renderSummary(demoPayload);
    renderTable(demoPayload.holders);
    els.results.hidden = false;
  }
})();
