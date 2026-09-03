    // BEGIN STAGE UI
    // BEGIN STAGE MODEL
    function stageAvailability(model) {
      return {
        method: true,
        input: !!model.method,
        requirements: model.pointCount > 0,
        routes: !!(model.routingBusy || model.routingSearched || model.routeCount),
        export: !!(model.pointCount || model.segmentCount || model.hasImage)
      };
    }
    // END STAGE MODEL
    const stageOrder = ['method', 'input', 'requirements', 'routes', 'export'];
    const stageNames = { method: 'Adding Pins', input: 'Add Points', requirements: 'Requirements', routes: 'Routes', export: 'Export' };
    const inputNames = { 'map-pins': 'Map pins', coordinates: 'Coordinates', text: 'TXT / CSV', gpx: 'GPX file', 'map-image': 'Route image', image: 'Map photo' };
    let currentStage = 'method';
    function availableStages() {
      return stageAvailability({ method: $('input-method').value, pointCount: state.points.length, segmentCount: state.segments.length, hasImage: !!state.imageUrl, routingBusy: routing.busy, routingSearched: routing.searched, routeCount: routing.result?.routes.length || 0 });
    }
    function setDockExpanded(expanded, focus = false) {
      $('control-dock').classList.toggle('collapsed', !expanded);
      $('control-dock-toggle').setAttribute('aria-expanded', String(expanded));
      $('control-dock-toggle').setAttribute('aria-label', `${expanded ? 'Minimize' : 'Open'} planning controls — ${stageNames[currentStage]}`);
      if (map) requestAnimationFrame(() => map.invalidateSize({ pan: false, animate: false }));
      if (focus && expanded) $('stage-tab-' + currentStage).focus({ preventScroll: true });
    }
    function setStage(stage, { expand = true, focus = false } = {}) {
      if (!availableStages()[stage]) return;
      if (stage !== 'input' && state.adding) setAdding(false);
      currentStage = stage;
      updateDockState();
      $('control-dock-body').scrollTop = 0;
      if (expand) setDockExpanded(true);
      if (focus) $('stage-tab-' + stage).focus({ preventScroll: true });
    }
    function updateDockState() {
      const available = availableStages();
      if (!available[currentStage]) currentStage = available.input ? 'input' : 'method';
      for (const stage of stageOrder) {
        const tab = $('stage-tab-' + stage), selected = currentStage === stage;
        tab.disabled = !available[stage];
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        $('stage-' + stage).hidden = !selected;
      }
      const method = $('input-method').value;
      $('stage-tab-input').lastElementChild.textContent = inputNames[method] || stageNames.input;
      $('input-stage-title').textContent = inputNames[method] || 'Add your points';
      $('manual-trace-tools').hidden = !['map-image', 'image'].includes(method) || !trace.bitmap;
      $('route-builder').hidden = !available.requirements;
      $('route-results').hidden = !available.routes;
      $('dock-map-controls').hidden = !available.export;
      $('dock-title').textContent = stageNames[currentStage];
      $('dock-summary').textContent = '';
      const expanded = !$('control-dock').classList.contains('collapsed');
      $('control-dock-toggle').setAttribute('aria-label', `${expanded ? 'Minimize' : 'Open'} planning controls — ${stageNames[currentStage]}`);
      const back = $('stage-back'), next = $('stage-next');
      back.hidden = currentStage === 'method';
      next.hidden = ['requirements', 'export'].includes(currentStage);
      next.textContent = currentStage === 'method' ? 'Continue →' : currentStage === 'input' ? 'Review waypoints →' : 'Export →';
      next.disabled = currentStage === 'method' ? !available.input : currentStage === 'input' ? !available.requirements : !routing.result?.routes.length;
      document.querySelector('.stage-footer').hidden = currentStage === 'method' && !available.input;
      $('route-details-button').hidden = !routing.selected;
    }
    for (const stage of stageOrder) $('stage-tab-' + stage).addEventListener('click', () => setStage(stage));
    document.querySelector('.stage-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const available = availableStages(), enabled = stageOrder.filter(stage => available[stage]);
      const index = enabled.indexOf(currentStage);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      event.preventDefault(); setStage(enabled[next], { focus: true });
    });
    // Native horizontal scrolling preserves trackpad momentum and touch gestures.
    // Keyboard browsing only applies to the row itself, never its action buttons.
    const routeOptions = $('route-options');
    routeOptions.addEventListener('keydown', event => {
      if (event.target !== routeOptions || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const cards = [...routeOptions.querySelectorAll('.route-choice')];
      if (!cards.length) return;
      const rowLeft = routeOptions.getBoundingClientRect().left;
      const positions = cards.map(card => card.getBoundingClientRect().left - rowLeft + routeOptions.scrollLeft - 2);
      const current = routeOptions.scrollLeft;
      const left = event.key === 'Home' ? 0 : event.key === 'End' ? routeOptions.scrollWidth : event.key === 'ArrowRight'
        ? positions.find(position => position > current + 2) ?? routeOptions.scrollWidth
        : positions.findLast(position => position < current - 2) ?? 0;
      event.preventDefault();
      routeOptions.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    $('stage-back').addEventListener('click', () => {
      const available = availableStages(), prior = stageOrder.slice(0, stageOrder.indexOf(currentStage)).filter(stage => available[stage]).at(-1);
      if (prior) setStage(prior);
    });
    $('stage-next').addEventListener('click', () => {
      if ($('stage-next').disabled) return;
      setStage(currentStage === 'method' ? 'input' : currentStage === 'input' ? 'requirements' : 'export');
    });
    $('control-dock-toggle').addEventListener('click', () => setDockExpanded($('control-dock').classList.contains('collapsed'), true));
    const syncDockHeight = () => {
      const dock = $('control-dock'), bottom = parseFloat(getComputedStyle(dock).bottom) || 0;
      document.documentElement.style.setProperty('--dock-visible-height', `${Math.ceil(dock.getBoundingClientRect().height + bottom)}px`);
    };
    new ResizeObserver(syncDockHeight).observe($('control-dock')); requestAnimationFrame(syncDockHeight);
    window.addEventListener('resize', syncDockHeight);
    function revealControl(id) {
      const target = $(id), stage = target?.closest('.stage-panel');
      if (stage) setStage(stage.id.replace('stage-', ''));
      const details = target?.closest('details'); if (details) details.open = true;
      if (target?.closest('#route-details-dialog') && !$('route-details-dialog').open) $('route-details-dialog').showModal();
    }
    $('control-dock').addEventListener('click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const target = $(link.getAttribute('href').slice(1));
      if (target) { event.preventDefault(); revealControl(target.id); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    $('route-details-button').addEventListener('click', () => $('route-details-dialog').showModal());
    $('close-route-details').addEventListener('click', () => $('route-details-dialog').close());
    // Keep processing feedback above the dock, without restoring information cards inside it.
    for (const id of ['ai-status', 'photo-status', 'trace-message']) {
      new MutationObserver(() => {
        const node = $(id);
        if (node.textContent.trim() && currentStage === 'input' && !$('stage-input').hidden) toast(node.textContent, node.classList.contains('error'), 7000);
      }).observe($(id), { childList: true, characterData: true, subtree: true });
    }
    // END STAGE UI
