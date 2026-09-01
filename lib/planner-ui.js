    // BEGIN PLANNER UI
    const routing = { selected: null, result: null, fingerprint: '', serial: 0, controller: null, worker: null, cache: new Map(), busy: false, evidence: '', blockedUntil: 0 };
    const planFields = ['region', 'order', 'date', 'distance', 'radius', 'tolerance', 'roads', 'provider'];
    const providers = { coffee: ['Private.coffee', 'https://overpass.private.coffee/api/interpreter'], vk: ['VK Maps', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'] };
    const regions = {
      hk: ['Hong Kong', 'AFCD hiking guidance', 'https://www.hiking.gov.hk/'],
      tw: ['Taiwan', 'Forestry and Nature Conservation Agency', 'https://recreation.forest.gov.tw/EN/'],
      jp: ['Japan', 'Ministry of the Environment national parks', 'https://www.env.go.jp/en/nature/nps/park/parks/'],
      kr: ['South Korea', 'Korea National Park Service', 'https://english.knps.or.kr/'],
      world: ['Other regions', 'Local trail authority required', null]
    };
    const km = metres => `${(metres / 1000).toFixed(1)} km`;
    const routingFingerprint = () => JSON.stringify([state.points, state.segments.length, state.source, ...planFields.map(id => $('plan-' + id).value)]);
    function activeRegion() {
      const choice = $('plan-region').value; if (choice !== 'auto') return choice;
      const p = state.points[0]; if (!p) return 'world';
      if (p.lat > 22.1 && p.lat < 22.6 && p.lon > 113.8 && p.lon < 114.5) return 'hk';
      if (p.lat > 21.8 && p.lat < 25.5 && p.lon > 119 && p.lon < 122.2) return 'tw';
      if (p.lat > 33 && p.lat < 38.7 && p.lon > 124.5 && p.lon < 131) return 'kr';
      if (p.lat > 24 && p.lat < 46 && p.lon > 122 && p.lon < 146) return 'jp';
      return 'world';
    }
    function stopRouting() { routing.serial++; routing.controller?.abort(); routing.worker?.terminate(); routing.controller = null; routing.worker = null; routing.busy = false; $('cancel-routing').hidden = true; }
    function invalidateRoutes() {
      stopRouting(); routing.selected = null; routing.result = null;
      $('route-options').replaceChildren(element('div', 'Review your places, then search for up to three distinct walking connections. Every option must include all your waypoints and mapped transport services at both ends.', 'routes-empty'));
      $('route-result-count').textContent = 'No routes searched yet'; $('selected-route-detail').hidden = true; $('route-export-review').hidden = true; $('routing-status').hidden = true;
      $('routing-evidence-note').textContent = 'Routes use mapped walking paths. Timetables, current access and suitability need your review.';
    }
    function updateGuidance() {
      const n = state.points.length, valid = n > 0 && n <= 16 && (!state.requiresTraceReview || trace.reviewed);
      $('find-routes').disabled = !valid || routing.busy;
      $('find-routes').textContent = routing.busy ? 'Finding walking connections…' : 'Find up to 3 routes →';
      $('view-inputs').disabled = !n || !map;
      const next = routing.selected ? 'Next: compare the route, check both transport services and trail access, then save GPX below.' : routing.result ? 'Next: choose a route to see its complete path and evidence before GPX export.' : !n ? 'Next: add the places your hike must visit, using coordinates, a file, an image or map pins.' : n > 16 ? 'This planner supports up to 16 mandatory places per local hike. No places will be silently dropped.' : 'Next: inspect every numbered pin and the visit order, then find routes.';
      $('next-action').replaceChildren(element('strong', next), element('p', `${regions[activeRegion()][0]} · ${n} mandatory place(s). ${state.segments.length ? 'Imported track lines are reference only; only the listed waypoints are mandatory. Add any missing must-visit places.' : 'Keep your order, or optimise the order for up to 8 places.'}`));
      if (routing.selected) {
        $('save-gpx').disabled = false; $('save-gpx').textContent = 'Save selected route as GPX ↓';
        $('route-export-status').textContent = 'The provisional route can be saved in the direction shown. Review the evidence and warnings first; they are not a safety certification.';
      } else $('save-gpx').textContent = 'Save input GPX (unrouted) ↓';
    }
    function externalLink(label, href) { const a = element('a', label + ' ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
    function showRoutes() {
      const cards = document.createDocumentFragment();
      routing.result.routes.forEach((route, i) => {
        const card = element('article', undefined, 'route-choice' + (routing.selected?.id === route.id ? ' selected' : ''));
        card.append(element('span', `Option ${i + 1} · provisional`, 'route-provisional'), element('h3', route.title), element('div', km(route.metres), 'route-km'));
        for (const [label, stop] of [['Start near', route.start], ['Finish near', route.end]]) { const p = element('p', undefined, 'route-stop'); p.append(element('strong', `${label} · ${stop.name}`), element('span', [...new Set(stop.services.filter(s => label === 'Start near' ? s.alight : s.board).map(s => s.ref))].slice(0, 6).join(' / '))); card.append(p); }
        const facts = element('ul', undefined, 'route-facts');
        for (const text of [`All ${state.points.length} places · order ${route.order.map(i => i + 1).join(' → ')}`, `${km(route.start.approach)} approach / ${km(route.end.approach)} exit walk`, `${km(route.roadMetres)} road connectors · ${km(route.repeatedMetres)} retraced`, `Largest waypoint offset: ${Math.ceil(Math.max(...route.snaps.map(s => s.metres)))} m`]) facts.append(element('li', text));
        const select = element('button', routing.selected?.id === route.id ? 'Viewing this route ✓' : 'View route & evidence →', 'route-select primary'); select.addEventListener('click', () => selectRoute(route)); card.append(facts, select); cards.append(card);
      });
      $('route-options').replaceChildren(cards); $('route-result-count').textContent = `${routing.result.routes.length} distinct option(s) found`;
      $('routing-evidence-note').textContent = `${routing.result.routes.length < 3 ? 'Fewer than three distinct options met your limits. No duplicates or invented connections were added. ' : ''}${routing.evidence}`;
    }
    function selectRoute(route) {
      routing.selected = route; showRoutes(); routeDetails(); render(); $('selected-route-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function routeDetails() {
      const r = routing.selected; if (!r) return;
      const detail = $('selected-route-detail'); detail.hidden = false; detail.replaceChildren(element('h3', `${r.title} · ${km(r.metres)}`));
      const grid = element('div', undefined, 'evidence-grid');
      const transport = element('div'); transport.append(element('h4', 'Transport: service links, not verified timetables'));
      for (const [label, stop, role] of [['Arrive at', r.start, 'alight'], ['Depart from', r.end, 'board']]) {
        const p = element('p'); p.append(element('strong', `${label} ${stop.name}. `), document.createTextNode(`Walking-network endpoint is ${Math.ceil(stop.accessGap)} m from this stop. That access gap is not routed and must be checked on site. `), externalLink('View stop', `https://www.openstreetmap.org/node/${stop.id}`)); transport.append(p);
        const ul = element('ul'); for (const s of stop.services.filter(s => s[role]).slice(0, 8)) { const li = element('li'); li.append(externalLink(`${s.mode} ${s.ref}${s.operator ? ' · ' + s.operator : ''}`, `https://www.openstreetmap.org/relation/${s.id}`)); ul.append(li); } transport.append(ul);
      }
      transport.append(element('p', `Check the operator’s actual service for ${$('plan-date').value || 'your hiking date'}, direction, first arrival and last departure. This app has no live timetable or closure feed.`));
      const trails = element('div'); trails.append(element('h4', 'Trail evidence and missing checks'), element('p', `${km(r.trailMetres)} follows mapped hiking relations or nearby AFCD corridors. ${km(r.unknownTerrainMetres)} of walking geometry has no difficulty tag. Untagged terrain can still be dangerous.`));
      const regional = regions[activeRegion()]; if (regional[2]) trails.append(externalLink(regional[1], regional[2]));
      if (r.official.length) {
        trails.append(element('p', `${km(r.corridorMetres)} lies near AFCD trail geometry (12 m matching tolerance). This approximate match is not proof of management, passability or safety.`));
        for (const f of r.official.slice(0, 8)) trails.append(element('p', `${f.TRAIL_NAME_EN || 'AFCD trail'} · ${f.DIFFICULTY_EN || 'difficulty unknown'}`));
      } else trails.append(element('p', 'Government-managed trail coverage is not established for this option. Government datasets are currently integrated only for Hong Kong; elsewhere, mapped hiking relations are a preference, not proof of official status.'));
      for (const rel of r.relations.slice(0, 6)) { const p = element('p'); p.append(externalLink(rel.name, `https://www.openstreetmap.org/relation/${rel.id}`)); trails.append(p); }
      trails.append(element('p', `OSM snapshot: ${r.osmTimestamp || 'timestamp unavailable'}. Search is bounded to a local area; this is a ranked candidate, not a guaranteed globally optimal route.`));
      grid.append(transport, trails); detail.append(grid);
      const wrap = element('div', undefined, 'snap-table-wrap'), table = element('table', undefined, 'snap-table'); table.innerHTML = '<thead><tr><th>Visit</th><th>Mandatory place</th><th>Input coordinate</th><th>Route coordinate</th><th>Offset</th></tr></thead>';
      const body = element('tbody'); r.order.forEach((index, visit) => { const s = r.snaps[index], row = element('tr'); for (const value of [visit + 1, `${index + 1}. ${s.original.name}`, `${s.original.lat.toFixed(6)}, ${s.original.lon.toFixed(6)}`, `${s.point.lat.toFixed(6)}, ${s.point.lon.toFixed(6)}`, `${Math.ceil(s.metres)} m`]) row.append(element('td', String(value))); body.append(row); }); table.append(body); wrap.append(table); detail.append(wrap);
      $('route-export-review').hidden = false;
    }
    function paintPlannedRoute() {
      const r = routing.selected; if (!r) return;
      if (map) {
        tracks.clearLayers(); markers.clearLayers(); L.polyline(r.coords.map(p => [p.lat, p.lon]), { color: '#263e35', weight: 5, opacity: .95 }).addTo(tracks);
        state.points.forEach((p, i) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'number-pin', html: `<span>${i + 1}</span>`, iconSize: [33, 33], iconAnchor: [16, 16] }), title: p.name }).bindPopup(element('div', `${p.name} · mandatory input; offset ${Math.ceil(r.snaps[i].metres)} m`)).addTo(markers));
        [r.coords[0], r.coords.at(-1)].forEach((p, i) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'direction-pin', html: i ? 'End' : 'Start', iconSize: [42, 26], iconAnchor: [i ? -10 : 32, i ? -8 : 44] }), title: i ? r.end.name : r.start.name }).bindPopup(element('div', `${i ? 'End near' : 'Start near'} ${i ? r.end.name : r.start.name} · check access to stop`)).addTo(markers));
      }
      $('map-caption').textContent = `${r.title} · provisional`; $('map-count').textContent = `${km(r.metres)} · all ${state.points.length} mandatory places`;
      $('track-legend').hidden = true; $('reverse-route').disabled = !r.reversible;
      $('direction-summary').replaceChildren(element('span', `Start · ${r.start.name}`), element('span', `End · ${r.end.name}`), element('span', r.reversible ? 'Reverse available · recheck both services' : 'Reverse unavailable: walking direction or service boarding rules'));
      $('export-note').textContent = 'The solid route follows connected OSM walking geometry. Small offsets to input pins and transport stops remain unverified and are not filled with invented connectors. Review the evidence above before GPX export.';
    }
    async function boundedJSON(url, options, maxBytes = 25 * 1024 * 1024) {
      const response = await fetch(url, options);
      if (!response.ok) { if ([429, 406].includes(response.status)) routing.blockedUntil = Date.now() + 30000; throw new Error(`Map service returned ${response.status}. ${[429, 406].includes(response.status) ? 'Wait at least 30 seconds before retrying.' : 'Try again later or choose another map data provider.'}`); }
      if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('Map response is too large. Reduce the search radius.');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) throw new Error('Map response is too large. Reduce the search radius.'); chunks.push(value); } } catch (e) { await reader.cancel(); throw e; }
      const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(buffer));
    }
    async function getOfficialTrails(box, signal) {
      if (activeRegion() !== 'hk') return { features: [], note: 'No government trail geometry is integrated for this region yet.' };
      const params = new URLSearchParams({ where: '1=1', geometry: `${box[1]},${box[0]},${box[3]},${box[2]}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'TRAIL_NAME_EN,DIFFICULTY_EN,WEBSITE', outSR: '4326', returnGeometry: 'true', f: 'geojson' });
      try { const data = await boundedJSON('https://portal.csdi.gov.hk/server/rest/services/common/afcd_rcd_1665568199103_4360/MapServer/0/query?' + params, { signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]) }, 12e6); if (!Array.isArray(data.features) || data.exceededTransferLimit) throw new Error(); return { features: data.features, note: 'AFCD corridor data checked; nearby geometry is not proof of current access.' }; }
      catch (e) { if (signal.aborted) throw e; return { features: [], note: 'AFCD trail data was unavailable. Government-managed coverage cannot be established.' }; }
    }
    function workerPlan(data, points, settings, features, serial) {
      return new Promise((resolve, reject) => {
        const code = $('routing-code').textContent + '\nself.onmessage = e => { try { const a=e.data; const result=TrailRouter.plan(a.data,a.points,a.settings,a.features,text=>self.postMessage({progress:text}));self.postMessage({result}); } catch(error) { self.postMessage({error:error.message}); } };';
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        try { const worker = new Worker(url); routing.worker = worker; worker.onmessage = e => { if (serial !== routing.serial) return; if (e.data.progress) $('routing-status').textContent = e.data.progress; else { worker.terminate(); routing.worker = null; e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); } }; worker.onerror = () => { worker.terminate(); reject(new Error('The route worker could not run. Try a current browser or a smaller search.')); }; worker.postMessage({ data, points, settings, features }); } finally { URL.revokeObjectURL(url); }
      });
    }
    $('find-routes').addEventListener('click', async () => {
      if ($('find-routes').disabled) return;
      if (Date.now() < routing.blockedUntil) { toast('The map provider asked us to pause. Wait 30 seconds before retrying.'); return; }
      stopRouting(); const serial = routing.serial, controller = new AbortController(); routing.controller = controller; routing.busy = true; routing.selected = null; routing.result = null; $('selected-route-detail').hidden = true; $('route-export-review').hidden = true; clearExport();
      $('cancel-routing').hidden = false; $('routing-status').hidden = false; $('routing-status').textContent = 'Downloading walking paths and mapped passenger services…';
      $('route-options').replaceChildren(element('div', 'Checking real paths and transport connections. This can take up to a minute; you can cancel.', 'routes-empty')); render(false);
      const timeout = setTimeout(() => controller.abort(), 65000);
      try {
        const radius = +$('plan-radius').value, box = TrailRouter.boundingBox(state.points, radius), provider = providers[$('plan-provider').value], key = provider[1] + '/' + box.join(',');
        const settings = { radius, maxApproach: radius, maxDistance: +$('plan-distance').value, maxRoad: +$('plan-roads').value, tolerance: +$('plan-tolerance').value, optimize: $('plan-order').value === 'optimize' };
        const officialPromise = getOfficialTrails(box, controller.signal); officialPromise.catch(() => {});
        let entry = routing.cache.get(key);
        if (!entry || Date.now() - entry.at > 600000) { const data = await boundedJSON(provider[1], { method: 'POST', body: new URLSearchParams({ data: TrailRouter.queryFor(box) }), signal: controller.signal }); entry = { data, at: Date.now() }; routing.cache.clear(); routing.cache.set(key, entry); }
        const official = await officialPromise; if (serial !== routing.serial) return;
        clearTimeout(timeout); routing.result = await workerPlan(entry.data, state.points.map(p => ({ ...p })), settings, official.features, serial); if (serial !== routing.serial) return;
        routing.evidence = `${provider[0]} / OpenStreetMap · ${routing.result.stopCount} service-linked stop candidates. ${official.note}`;
        routing.busy = false; $('routing-status').textContent = `Found ${routing.result.routes.length} option(s) through every waypoint. Select one below to review before export.`; showRoutes();
        $('route-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        if (serial !== routing.serial) return;
        const text = controller.signal.aborted ? 'The map request timed out. No route was produced. Try a smaller search radius or choose the other provider.' : e.message || 'The map service could not be reached. Check your connection or choose another provider.';
        $('routing-status').textContent = text; $('route-options').replaceChildren(element('div', text, 'routes-empty')); $('route-result-count').textContent = 'No qualifying routes';
      } finally { clearTimeout(timeout); if (serial === routing.serial) { controller.abort(); routing.busy = false; routing.controller = null; $('cancel-routing').hidden = true; updateGuidance(); } }
    });
    $('cancel-routing').addEventListener('click', () => { stopRouting(); $('routing-status').textContent = 'Search cancelled. Your waypoints are unchanged.'; $('route-options').replaceChildren(element('div', 'Search cancelled. Review your places and search again when ready.', 'routes-empty')); updateGuidance(); });
    $('view-inputs').addEventListener('click', () => { routing.selected = null; $('selected-route-detail').hidden = true; $('route-export-review').hidden = true; if (routing.result) showRoutes(); render(); $('map-title').scrollIntoView({ behavior: 'smooth' }); });
    for (const id of planFields) $('plan-' + id).addEventListener('change', () => render(false));
    const today = new Date(); $('plan-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    function reversePlannedRoute() {
      const r = routing.selected; if (!r || !r.reversible) return;
      [r.start, r.end] = [r.end, r.start]; r.coords.reverse(); r.ids.reverse(); r.edges.reverse(); r.order.reverse(); showRoutes(); routeDetails(); render(); toast('Route reversed. Review arrival, departure and trail access again before saving.');
    }
    function plannedGPX(r) {
      const warning = `PROVISIONAL ROUTE — independently check before navigation. Connected OSM walking ways only; no artificial connectors. Start near ${r.start.name} (${Math.ceil(r.start.accessGap)} m unrouted stop gap); end near ${r.end.name} (${Math.ceil(r.end.accessGap)} m gap). All ${state.points.length} mandatory waypoints visited within the explicitly accepted ${$('plan-tolerance').value} m tolerance. OSM snapshot ${r.osmTimestamp || 'unknown'}. Hiking date ${$('plan-date').value}. Timetables, closures, permits, terrain and management are not automatically verified. OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright. AFCD corridor matches, where available, are approximate. No elevation invented.`;
      const decimal = n => n.toFixed(8), wpts = [{ ...r.coords[0], name: 'Start near ' + r.start.name }, ...r.order.map(i => state.points[i]), { ...r.coords.at(-1), name: 'End near ' + r.end.name }];
      return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trailcraft" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xmlText(r.title)}</name><desc>${xmlText(warning)}</desc><time>${new Date().toISOString()}</time></metadata>${wpts.map(p => `<wpt lat="${decimal(p.lat)}" lon="${decimal(p.lon)}"><name>${xmlText(p.name)}</name></wpt>`).join('')}<trk><name>${xmlText(r.title)} — provisional</name><desc>${xmlText(warning)}</desc><trkseg>${r.coords.map(p => `<trkpt lat="${decimal(p.lat)}" lon="${decimal(p.lon)}"></trkpt>`).join('')}</trkseg></trk></gpx>`;
    }
    // END PLANNER UI
