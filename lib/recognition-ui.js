    // BEGIN RECOGNITION UI
    const ai = { image: null, controller: null, revision: 0, candidates: [], result: null };
    if (location.hostname === '127.0.0.1' && location.port === '8787') $('ai-endpoint').value = location.origin + '/api/recognize-map';
    function resetRecognition() {
      ai.revision++; ai.controller?.abort(); ai.controller = null; ai.image = null; ai.result = null; ai.candidates = [];
      $('ai-review').hidden = true; $('ai-results').hidden = true; $('ai-consent').checked = false; $('ai-complete').checked = false; $('cancel-recognition').hidden = true; $('ai-candidates').replaceChildren();
    }
    function recognitionEndpoint() {
      const raw = $('ai-endpoint').value.trim(); if (!raw) return null;
      const url = new URL(raw); if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/recognize-map')) throw new Error('Use the private server’s /api/recognize-map endpoint, without credentials or query parameters.');
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && ['localhost', '127.0.0.1'].includes(location.hostname))) throw new Error('The private recognition endpoint must use HTTPS. Local HTTP is allowed only when running this app locally.');
      return url;
    }
    function updateRecognition() {
      let endpoint = null; try { endpoint = recognitionEndpoint(); } catch {}
      $('recognize-map').disabled = !ai.image || !endpoint || !$('ai-consent').checked || !!ai.controller;
      $('use-ai-waypoints').disabled = !ai.candidates.length || !$('ai-complete').checked || !ai.candidates.every(p => p.confirmed && p.coordinate);
    }
    function openRecognition(probe) {
      ai.image = probe; $('ai-review').hidden = false; $('ai-connection').open = !$('ai-endpoint').value;
      $('ai-status').textContent = $('ai-endpoint').value ? 'Ready to identify this image. Add a clue if you have one, then give permission to send it to Kimi.' : 'A private recognition server has not been connected. Configure its endpoint, or use manual calibration below. Your image has not left this device.';
      updateRecognition();
    }
    function displayRecognition(result) {
      ai.result = result; $('ai-results').hidden = false; $('ai-complete').checked = false;
      $('ai-area').textContent = result.status === 'not_map' ? 'A readable map could not be identified' : result.area.name ? `Suggested area: ${result.area.name}` : 'The map’s location is still unknown';
      $('ai-evidence').textContent = `${result.area.country || 'Country uncertain'} · ${result.area.confidence} confidence (model assessment, not measured accuracy). ${result.area.evidence}`;
      $('ai-questions').textContent = [...result.warnings, ...result.questions, 'Check positions on an independent map. AI coordinates may be wrong, even when confidence is high.'].join(' ');
      const canvas = $('ai-overlay'), image = ai.image, ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight)); canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      result.waypoints.forEach((p, i) => { if (p.x == null || p.y == null) return; const x = p.x * canvas.width, y = p.y * canvas.height; ctx.beginPath(); ctx.arc(x, y, 14, 0, 2 * Math.PI); ctx.fillStyle = '#bc4827'; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(String(i + 1), x, y); });
      ai.candidates = result.waypoints.map(p => ({ ...p, confirmed: false, coordinate: null })); const rows = document.createDocumentFragment();
      ai.candidates.forEach((p, i) => {
        const row = element('div', undefined, 'ai-candidate'), label = element('label', `${i + 1}. ${p.label}`, 'field'), input = document.createElement('input'); input.type = 'text'; input.id = `ai-coordinate-${i}`; input.placeholder = 'Verified latitude, longitude'; input.value = p.lat != null && p.lon != null ? `${p.lat}, ${p.lon}` : ''; label.htmlFor = input.id;
        const checkLabel = element('label', undefined, 'image-confirm'), check = document.createElement('input'); check.type = 'checkbox'; checkLabel.append(check, element('span', 'I independently checked this coordinate and image marker.'));
        const status = element('p', `${p.basis.replaceAll('_', ' ')} · ${p.confidence} confidence. ${p.evidence}`, 'help'); const mapLink = element('a', 'Check coordinate on OpenStreetMap ↗', 'text-button'); mapLink.target = '_blank'; mapLink.rel = 'noopener noreferrer';
        const validate = () => { p.coordinate = null; try { const points = parseCoordinates(input.value); if (points.length === 1) p.coordinate = { ...points[0], name: p.label }; } catch {} check.disabled = !p.coordinate; mapLink.hidden = !p.coordinate; if (p.coordinate) mapLink.href = `https://www.openstreetmap.org/?mlat=${p.coordinate.lat}&mlon=${p.coordinate.lon}#map=16/${p.coordinate.lat}/${p.coordinate.lon}`; p.confirmed = check.checked && !!p.coordinate; updateRecognition(); };
        input.addEventListener('input', () => { check.checked = false; $('ai-complete').checked = false; validate(); }); check.addEventListener('change', validate);
        row.append(label, input, status, mapLink, checkLabel); rows.append(row); validate();
      });
      if (!ai.candidates.length) rows.append(element('p', 'No marked waypoints were identified. Provide a clearer image or enter the must-visit places manually. A coloured route without pins can still use the manual trace converter.', 'message'));
      $('ai-candidates').replaceChildren(rows); updateRecognition();
    }
    for (const id of ['ai-endpoint', 'ai-access']) $(id).addEventListener('input', updateRecognition);
    $('ai-consent').addEventListener('change', updateRecognition); $('ai-complete').addEventListener('change', updateRecognition);
    $('recognize-map').addEventListener('click', async () => {
      if ($('recognize-map').disabled) return;
      const revision = ++ai.revision, controller = new AbortController(); ai.controller = controller; $('cancel-recognition').hidden = false; $('ai-results').hidden = true; ai.candidates = []; updateRecognition();
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const endpoint = recognitionEndpoint(); if (!endpoint) throw new Error('Connect a private recognition server first.');
        const image = ai.image, scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        // Canvas serialization strips camera metadata before the explicitly consented upload.
        const data = canvas.toDataURL('image/jpeg', .88); if (data.length > 2800000) throw new Error('This image is too detailed to send within the size limit. Crop or resize it first.');
        $('ai-status').textContent = `Reading map labels and visible pins with Kimi through ${endpoint.host}. This may take up to two minutes. No waypoints will be added automatically.`;
        const headers = { 'Content-Type': 'application/json' }; if ($('ai-access').value) headers.Authorization = 'Bearer ' + $('ai-access').value;
        const response = await fetch(endpoint.href, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ image: data, context: $('ai-context').value, consent: true }) });
        const body = await response.json(); if (revision !== ai.revision) return;
        if (!response.ok) throw new Error(body.error || `Recognition server returned ${response.status}.`);
        if (!body.result || !Array.isArray(body.result.waypoints) || body.result.waypoints.length > 16 || !body.result.area || !Array.isArray(body.result.warnings) || !Array.isArray(body.result.questions)) throw new Error('The private server returned an invalid result. No waypoints were accepted.');
        displayRecognition(body.result); $('ai-status').textContent = 'Recognition finished. Review the area, each image marker and its coordinates below. Uncertain positions are not accepted automatically.';
      } catch (e) { if (revision === ai.revision) $('ai-status').textContent = controller.signal.aborted ? 'Recognition cancelled or timed out. No waypoints were added. The provider may have already processed the image.' : e.message || 'Recognition is unavailable. Use manual calibration or try again later.'; }
      finally { clearTimeout(timeout); if (revision === ai.revision) { ai.controller = null; $('cancel-recognition').hidden = true; updateRecognition(); } }
    });
    $('cancel-recognition').addEventListener('click', () => ai.controller?.abort());
    $('use-ai-waypoints').addEventListener('click', () => {
      if ($('use-ai-waypoints').disabled || !ai.candidates.every(p => p.confirmed && p.coordinate)) return;
      replaceDraft(ai.candidates.map(p => ({ ...p.coordinate })), [], 'User-confirmed Kimi image waypoints'); message('Confirmed image places added. Review the pins and choose your route settings in step 2.'); $('route-builder').scrollIntoView({ behavior: 'smooth' });
    });
    // END RECOGNITION UI
