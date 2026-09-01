    // BEGIN PLANNER UI
    const ROUTE_COLORS = ['#087f68', '#d4572f', '#6555a5'];
    const routing = { selected: null, result: null, visible: new Set(), fingerprint: '', serial: 0, controller: null, worker: null, cache: new Map(), busy: false, searched: false, evidence: '', blockedUntil: 0 };
    const planFields = ['region', 'order', 'date', 'distance', 'radius', 'tolerance', 'roads', 'provider'];
    const providers = {
      coffee: { name: 'Private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
      vk: { name: 'VK Maps', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
      fossgis: { name: 'FOSSGIS', url: 'https://overpass-api.de/api/interpreter' }
    };
    const automaticProviderOrder = ['coffee', 'vk', 'fossgis'];
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
      stopRouting(); routing.selected = null; routing.result = null; routing.visible.clear(); routing.searched = false;
      $('route-options').replaceChildren(element('div', 'Review your places, then search for up to three distinct walking connections. Every option must include all your waypoints and mapped transport services at both ends.', 'routes-empty'));
      $('route-result-count').textContent = 'No routes searched yet'; $('selected-route-detail').hidden = true; $('route-export-review').hidden = true; $('route-visibility-controls').hidden = true; $('save-all-gpx').disabled = true; $('routing-status').hidden = true;
      $('routing-evidence-note').textContent = 'Routes use mapped walking paths. Timetables, current access and suitability need your review.';
    }
    function updateGuidance() {
      const n = state.points.length, valid = n > 0 && n <= 16 && (!state.requiresTraceReview || trace.reviewed);
      $('find-routes').disabled = !valid || routing.busy;
      $('find-routes').textContent = routing.busy ? 'Finding walking connections…' : 'Find up to 3 routes →';
      $('view-inputs').disabled = !n || !map;
      if (routing.selected) {
        $('save-gpx').disabled = false; $('save-gpx').textContent = 'Save selected route as GPX ↓';
        $('route-export-status').textContent = 'The provisional route can be saved in the direction shown. Review the evidence and warnings first; they are not a safety certification.';
      } else $('save-gpx').textContent = 'Save input GPX (unrouted) ↓';
      $('save-all-gpx').disabled = !routing.result?.routes?.length;
      updateInputGuide();
    }
    function externalLink(label, href) { const a = element('a', label + ' ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
    function showRouteVisibility() {
      const routes = routing.result?.routes || [], controls = $('route-visibility-controls'), items = document.createDocumentFragment();
      controls.hidden = !routes.length;
      routes.forEach((route, i) => {
        const button = element('button', `Route ${i + 1}`, 'route-toggle'); button.type = 'button'; button.style.setProperty('--route-color', ROUTE_COLORS[i]); button.setAttribute('aria-pressed', String(routing.visible.has(route.id)));
        button.addEventListener('click', () => { routing.visible.has(route.id) ? routing.visible.delete(route.id) : routing.visible.add(route.id); showRouteVisibility(); render(false); }); items.append(button);
      });
      $('route-visibility').replaceChildren(items);
    }
    function showRoutes() {
      const cards = document.createDocumentFragment();
      routing.result.routes.forEach((route, i) => {
        const card = element('article', undefined, 'route-choice' + (routing.selected?.id === route.id ? ' selected' : ''));
        card.append(element('span', `Option ${i + 1} · provisional`, 'route-provisional'), element('h3', route.title), element('div', km(route.metres), 'route-km'));
        for (const [label, stop] of [['Start near', route.start], ['Finish near', route.end]]) { const p = element('p', undefined, 'route-stop'); p.append(element('strong', `${label} · ${stop.name}`), element('span', [...new Set(stop.services.filter(s => label === 'Start near' ? s.alight : s.board).map(s => s.ref))].slice(0, 6).join(' / '))); card.append(p); }
        const facts = element('ul', undefined, 'route-facts');
        for (const text of [`All ${state.points.length} places · order ${route.order.map(i => i + 1).join(' → ')}`, `${km(route.start.approach)} approach / ${km(route.end.approach)} exit walk`, `${km(route.roadMetres)} road connectors · ${km(route.repeatedMetres)} retraced`, `Largest waypoint offset: ${Math.ceil(Math.max(...route.snaps.map(s => s.metres)))} m`]) facts.append(element('li', text));
        const select = element('button', routing.selected?.id === route.id ? 'Selected route ✓' : 'Select this route →', 'route-select primary'); select.addEventListener('click', () => selectRoute(route));
        const save = element('button', `Save Route ${i + 1} GPX ↓`, 'route-select'); save.addEventListener('click', () => { download(new Blob([plannedGPX(route)], { type: 'application/gpx+xml;charset=utf-8' }), `trailplanner-route-${i + 1}-PROVISIONAL.gpx`); track('gpx_exported'); });
        card.append(facts, select, save); cards.append(card);
      });
      $('route-options').replaceChildren(cards); $('route-result-count').textContent = `${routing.result.routes.length} distinct option(s) found`;
      $('routing-evidence-note').textContent = `${routing.result.routes.length < 3 ? 'Fewer than three distinct options met your limits. No duplicates or invented connections were added. ' : ''}${routing.evidence}`;
      showRouteVisibility();
    }
    function selectRoute(route) {
      routing.selected = route; routing.visible.add(route.id); showRoutes(); routeDetails(); render(); setDockExpanded(false);
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
      const routes = routing.result?.routes || []; if (!routes.length) return;
      if (map) {
        routes.forEach((route, i) => {
          if (!routing.visible.has(route.id)) return;
          const selected = routing.selected?.id === route.id, color = ROUTE_COLORS[i];
          L.polyline(route.coords.map(p => [p.lat, p.lon]), { color, weight: selected ? 7 : 5, opacity: selected ? 1 : .78 }).bindPopup(`Route ${i + 1} · ${route.title} · ${km(route.metres)}`).addTo(tracks);
          const midpoint = route.coords[Math.floor(route.coords.length / 2)];
          if (midpoint) L.marker([midpoint.lat, midpoint.lon], { interactive: false, icon: L.divIcon({ className: 'route-line-label', html: `<span style="background:${color}">Route ${i + 1}</span>`, iconSize: [76, 26], iconAnchor: [38, 13] }) }).addTo(markers);
        });
        const r = routing.selected;
        if (r && routing.visible.has(r.id)) [r.coords[0], r.coords.at(-1)].forEach((p, i) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'direction-pin', html: i ? 'End' : 'Start', iconSize: [42, 26], iconAnchor: [21, 13] }), title: i ? r.end.name : r.start.name }).bindPopup(element('div', `${i ? 'End near' : 'Start near'} ${i ? r.end.name : r.start.name} · check access to stop`)).addTo(markers));
      }
      const r = routing.selected; if (!r) { $('map-caption').textContent = `${routes.length} proposed route${routes.length === 1 ? '' : 's'}`; $('map-count').textContent = 'Choose any combination below'; return; }
      $('map-caption').textContent = `${r.title} · provisional`; $('map-count').textContent = `${km(r.metres)} · all ${state.points.length} mandatory places`;
      $('track-legend').hidden = true; $('reverse-route').disabled = !r.reversible;
      $('direction-summary').replaceChildren(element('span', `Start · ${r.start.name}`), element('span', `End · ${r.end.name}`), element('span', r.reversible ? 'Reverse available · recheck both services' : 'Reverse unavailable: walking direction or service boarding rules'));
      $('export-note').textContent = 'The solid route follows connected OSM walking geometry. Small offsets to input pins and transport stops remain unverified and are not filled with invented connectors. Review the evidence above before GPX export.';
    }
    async function boundedJSON(url, options, maxBytes = 25 * 1024 * 1024) {
      const response = await fetch(url, options);
      if (!response.ok) {
        const paused = [429, 406].includes(response.status), transient = [502, 503, 504].includes(response.status);
        if (paused) routing.blockedUntil = Date.now() + 30000;
        const error = new Error(`Map service returned ${response.status}. ${paused ? 'Wait at least 30 seconds before retrying.' : transient ? 'The provider is temporarily unavailable.' : 'Try again later or choose another map data provider.'}`);
        error.status = response.status; error.transient = transient; throw error;
      }
      if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('Map response is too large. Reduce the search radius.');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) throw new Error('Map response is too large. Reduce the search radius.'); chunks.push(value); } } catch (e) { await reader.cancel(); throw e; }
      const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(buffer));
    }
    function canTryAnotherProvider(error) {
      return error?.transient || error?.name === 'TimeoutError' || error instanceof TypeError;
    }
    async function getMapData(box, selected, signal) {
      const choices = selected === 'auto' ? automaticProviderOrder : [selected], failures = [];
      for (let index = 0; index < choices.length; index++) {
        const provider = providers[choices[index]];
        if (!provider) throw new Error('Choose a valid map data provider.');
        if (signal.aborted) throw new DOMException('Route search cancelled', 'AbortError');
        $('routing-status').textContent = `${index ? 'Trying backup' : 'Contacting'} ${provider.name} for walking paths and public transport…`;
        const key = provider.url + '/' + box.join(',');
        let entry = routing.cache.get(key);
        try {
          if (!entry || Date.now() - entry.at > 600000) {
            const data = await boundedJSON(provider.url, { method: 'POST', body: new URLSearchParams({ data: TrailRouter.queryFor(box) }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
            entry = { data, at: Date.now() }; routing.cache.set(key, entry);
            while (routing.cache.size > 6) routing.cache.delete(routing.cache.keys().next().value);
          }
          return { data: entry.data, provider };
        } catch (error) {
          if (signal.aborted) throw error;
          failures.push(`${provider.name}: ${error?.status || (error?.name === 'TimeoutError' ? 'timeout' : 'network error')}`);
          if (!canTryAnotherProvider(error) || index === choices.length - 1) {
            if (selected === 'auto' && failures.length > 1 && canTryAnotherProvider(error)) throw new Error(`All automatic map providers were unavailable (${failures.join('; ')}). Try again later or use a smaller search radius.`);
            throw error;
          }
        }
      }
      throw new Error('No map data provider is available.');
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
      stopRouting(); const serial = routing.serial, controller = new AbortController(); routing.controller = controller; routing.busy = true; routing.searched = true; routing.selected = null; routing.result = null; routing.visible.clear(); $('selected-route-detail').hidden = true; $('route-export-review').hidden = true; $('route-visibility-controls').hidden = true; clearExport();
      $('cancel-routing').hidden = false; $('routing-status').hidden = false; $('routing-status').textContent = 'Downloading walking paths and mapped passenger services…';
      $('route-options').replaceChildren(element('div', 'Checking real paths and transport connections. This can take up to a minute; you can cancel.', 'routes-empty')); render(false);
      const timeout = setTimeout(() => controller.abort(), 65000);
      try {
        const radius = +$('plan-radius').value, box = TrailRouter.boundingBox(state.points, radius);
        const settings = { radius, maxApproach: radius, maxDistance: +$('plan-distance').value, maxRoad: +$('plan-roads').value, tolerance: +$('plan-tolerance').value, optimize: $('plan-order').value === 'optimize' };
        const officialPromise = getOfficialTrails(box, controller.signal); officialPromise.catch(() => {});
        const mapData = await getMapData(box, $('plan-provider').value, controller.signal);
        const official = await officialPromise; if (serial !== routing.serial) return;
        clearTimeout(timeout); routing.result = await workerPlan(mapData.data, state.points.map(p => ({ ...p })), settings, official.features, serial); if (serial !== routing.serial) return;
        routing.evidence = `${mapData.provider.name} / OpenStreetMap · ${routing.result.stopCount} service-linked stop candidates. ${official.note}`;
        routing.result.routes.forEach(route => routing.visible.add(route.id));
        routing.busy = false; $('routing-status').textContent = `Found ${routing.result.routes.length} option(s) through every waypoint. Select one below to review before export.`; showRoutes(); render(); setDockExpanded(false);
        $('route-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        if (serial !== routing.serial) return;
        const text = controller.signal.aborted ? 'The map request timed out. No route was produced. Try a smaller search radius or search again later.' : e.message || 'The map service could not be reached. Check your connection or search again later.';
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
      return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TrailPlanner" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xmlText(r.title)}</name><desc>${xmlText(warning)}</desc><time>${new Date().toISOString()}</time></metadata>${wpts.map(p => `<wpt lat="${decimal(p.lat)}" lon="${decimal(p.lon)}"><name>${xmlText(p.name)}</name></wpt>`).join('')}<trk><name>${xmlText(r.title)} — provisional</name><desc>${xmlText(warning)}</desc><trkseg>${r.coords.map(p => `<trkpt lat="${decimal(p.lat)}" lon="${decimal(p.lon)}"></trkpt>`).join('')}</trkseg></trk></gpx>`;
    }
    function allRoutesGPX(routes) {
      const stamp = new Date().toISOString(), decimal = n => n.toFixed(8), warning = `PROVISIONAL ROUTE OPTIONS — independently check before navigation. Each track uses connected OpenStreetMap walking ways and visits every mandatory waypoint. Timetables, closures, permits, terrain, current access and government management are not automatically verified. OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright. No elevation invented.`;
      const waypoints = state.points.map((p, i) => `<wpt lat="${decimal(p.lat)}" lon="${decimal(p.lon)}"><name>${xmlText(`${i + 1}. ${p.name}`)}</name></wpt>`).join('');
      const tracksXML = routes.map((r, i) => `<trk><name>${xmlText(`Route ${i + 1} — ${r.title} — provisional`)}</name><desc>${xmlText(`${warning} Start near ${r.start.name}; end near ${r.end.name}.`)}</desc><trkseg>${r.coords.map(p => `<trkpt lat="${decimal(p.lat)}" lon="${decimal(p.lon)}"></trkpt>`).join('')}</trkseg></trk>`).join('');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TrailPlanner" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>TrailPlanner route options</name><desc>${xmlText(warning)}</desc><time>${stamp}</time></metadata>${waypoints}${tracksXML}</gpx>`;
    }
    $('show-all-routes').addEventListener('click', () => { routing.result?.routes.forEach(route => routing.visible.add(route.id)); showRouteVisibility(); render(false); });
    $('hide-all-routes').addEventListener('click', () => { routing.visible.clear(); showRouteVisibility(); render(false); });
    // END PLANNER UI
