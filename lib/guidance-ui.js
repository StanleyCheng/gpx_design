    // BEGIN GUIDANCE UI
    // BEGIN GUIDANCE STATE
    function guideStateFor(model) {
      if (model.hasSelectedRoute) return { step: 4, action: 'review-save' };
      if (model.hasRoutes) return { step: 4, action: 'compare-routes' };
      if (model.routingBusy) return { step: 3, action: 'waiting-routes' };
      if (model.pointCount > 16) return { step: 3, action: 'review-remove' };
      if (model.pointCount > 0) return { step: 3, action: 'route-settings' };
      if (model.method === 'map-pins') return { step: 1, action: 'add-map-pins' };
      if (model.method === 'coordinates') return model.hasCoordinatesText ? { step: 2, action: 'preview-coordinates' } : { step: 1, action: 'focus-coordinates' };
      if (model.method === 'text') return { step: 1, action: 'choose-text' };
      if (model.method === 'gpx') return { step: 1, action: 'choose-gpx' };
      if (model.method === 'map-image' || model.method === 'image') {
        if (!model.hasImage) return { step: 1, action: 'choose-image' };
        if (model.recognitionBusy) return { step: 2, action: 'waiting-recognition' };
        if (model.hasRecognitionResult) return { step: 3, action: 'review-candidates' };
        if (model.method === 'image' && model.hasPhotoGPS) return { step: 2, action: 'add-photo-gps' };
        return { step: 2, action: model.hasRecognitionEndpoint ? 'identify-image' : 'setup-recognition' };
      }
      return { step: 1, action: 'focus-coordinates' };
    }
    // END GUIDANCE STATE

    const GUIDE_LANGUAGE_KEY = 'trailcraft.guide-language.v1';
    const guideCopy = {
      en: {
        title: 'Your next step', language: 'Guidance language', switchLanguage: '繁體中文', stepOf: step => `Step ${step} of 4`,
        methods: {
          'map-pins': { label: 'Put pins on the map', steps: ['Move the map to your hiking area.', 'Tap or click every place the hike must visit.', 'Check the pin order and find up to 3 routes.', 'Choose a route, check the map, and save GPX.'] },
          coordinates: { label: 'Paste coordinates', steps: ['Paste latitude and longitude.', 'Show the places as numbered pins.', 'Check route settings and find up to 3 routes.', 'Choose a route, check the map, and save GPX.'] },
          text: { label: 'Upload TXT or CSV', steps: ['Choose a TXT or CSV file with coordinates.', 'Check the imported places and their order.', 'Check route settings and find up to 3 routes.', 'Choose a route, check the map, and save GPX.'] },
          gpx: { label: 'Upload GPX', steps: ['Choose a GPX file.', 'Check its listed places and reference track.', 'Check route settings and find up to 3 routes.', 'Choose a route, check the map, and save GPX.'] },
          'map-image': { label: 'Use a route-map image', steps: ['Add a clear route-map image.', 'Use Kimi to find the map and marked places.', 'Choose every place the hike must visit.', 'Compare routes, check the full map, and save GPX.'] },
          image: { label: 'Review a map image or photo', steps: ['Add a clear map image or photo.', 'Use Kimi or photo GPS to find its location.', 'Choose every place the hike must visit.', 'Compare routes, check the full map, and save GPX.'] }
        },
        prompts: {
          'add-map-pins': ['Add the places your hike must visit.', 'Tap Start adding pins, then tap the map. Drag a pin to move it; tap or right-click it to delete.'],
          'focus-coordinates': ['Put one place on each line.', 'Start with latitude, then longitude.'],
          'preview-coordinates': ['Ready to show your places.', 'The app will turn each pair into a numbered pin.'],
          'choose-text': ['Choose your coordinate file.', 'Use a TXT or CSV file with latitude and longitude.'],
          'choose-gpx': ['Choose your GPX file.', 'Imported track lines are only a reference. Check the listed places.'],
          'choose-image': ['Add a clear picture of the map.', 'Use a screenshot or a flat, well-lit photo with readable names and markers.'],
          'setup-recognition': ['Map reading is not connected yet.', 'The public page needs your private HTTPS recognition connection. You can enter coordinates instead.'],
          'identify-image': ['Ask Kimi to find the map and its marks.', 'Check the connection, then start identification yourself. The image is sent only after you select Identify.'],
          'waiting-recognition': ['Kimi is reading the map.', 'Wait for the suggested area and marked places. Nothing is added automatically.'],
          'review-candidates': ['Check every suggested place.', 'Include every place the hike must visit, and fix any wrong coordinate.'],
          'add-photo-gps': ['A photo location was found.', 'It may be where the camera was, not the place shown on the map. Check it first.'],
          'review-remove': ['There are too many places for route search.', 'Keep 16 or fewer. No place will be dropped for you.'],
          'route-settings': ['Check the numbered pins and route settings.', 'The route will visit every listed place and look for public transport at both ends.'],
          'waiting-routes': ['Looking for real walking connections.', 'This can take up to a minute. The app will not invent a missing path.'],
          'compare-routes': ['Compare the route options.', 'Choose only after checking that every place, start and finish makes sense.'],
          'review-save': ['Review the complete route before saving.', 'Check actual transport times, trail access, closures and conditions for your hiking day.']
        },
        actions: {
          'add-map-pins': 'Start adding pins',
          'focus-coordinates': 'Enter my places', 'preview-coordinates': 'Show my places', 'choose-text': 'Choose TXT or CSV', 'choose-gpx': 'Choose GPX', 'choose-image': 'Add map picture', 'setup-recognition': 'Set up map reading', 'identify-image': 'Go to map identification', 'waiting-recognition': 'Reading the map…', 'review-candidates': 'Review suggested places', 'add-photo-gps': 'Review photo location', 'review-remove': 'Review and remove places', 'route-settings': 'Check settings and find routes', 'waiting-routes': 'Finding routes…', 'compare-routes': 'Compare route options', 'review-save': 'Review route and save'
        },
        paste: 'Or paste from clipboard', trace: 'Need an exact copy of the coloured line? Use image tracing.', coordinatesInstead: 'Enter coordinates instead',
        notes: {
          points: n => `${n} place${n === 1 ? '' : 's'} ready. Route search will choose a start and finish near mapped public transport.`,
          trace: 'This traced line is unverified. Route search uses only its two endpoints and does not promise to follow the coloured line.',
          gpx: 'A GPX track is a reference line. If it has no waypoints, only each segment’s first and last point become mandatory.',
          routes: 'Every option shown uses connected mapped paths and all mandatory places. Fewer than three is allowed.',
          selected: 'The route is provisional. Check live transport, official trail notices, weather and conditions before hiking.'
        },
        safetyTitle: 'Why these steps matter', officialTitle: 'Use official trails first', officialCopy: 'A path on a map may still be closed, private or unsafe.', transitTitle: 'Plan how to get there and home', transitCopy: 'Check the real transport times for the day of your hike.', connectionsTitle: 'Never guess a missing path', connectionsCopy: 'The app shows fewer routes when it cannot find a real connection.', privacy: 'Files stay on this device unless you choose Kimi map identification.',
        next: {
          empty: 'Step 1: add every place the hike must visit.', tooMany: 'Route search can use up to 16 mandatory places. Remove extras before searching.', ready: 'Step 3: check every numbered pin and the settings, then find routes.', busy: 'Looking for connected mapped paths and public transport at both ends…', routes: 'Step 4: choose a route to see its complete path and evidence.', selected: 'Step 4: check the full route, transport and trail access before saving.'
        },
        mandatory: n => `${n} mandatory place${n === 1 ? '' : 's'}`, trackReference: 'Imported track lines are reference only; only listed places are mandatory.', order: 'Keep your order, or optimise up to 8 places.', regions: { hk: 'Hong Kong', tw: 'Taiwan', jp: 'Japan', kr: 'South Korea', world: 'Other regions' }
      },
      'zh-Hant': {
        title: '下一步', language: '指示語言', switchLanguage: 'English', stepOf: step => `第 ${step} 步，共 4 步`,
        methods: {
          'map-pins': { label: '在地圖加入圖釘', steps: ['把地圖移到行山地區。', '點按行程一定要經過的每個地點。', '檢查圖釘次序，再尋找最多 3 條路線。', '選擇路線、查看地圖，再儲存 GPX。'] },
          coordinates: { label: '貼上座標', steps: ['貼上緯度和經度。', '把地點顯示為編號圖釘。', '查看路線設定，並尋找最多 3 條路線。', '選擇路線、查看完整地圖，再儲存 GPX。'] },
          text: { label: '上載 TXT 或 CSV', steps: ['選擇有座標的 TXT 或 CSV 檔案。', '檢查匯入的地點和次序。', '查看路線設定，並尋找最多 3 條路線。', '選擇路線、查看完整地圖，再儲存 GPX。'] },
          gpx: { label: '上載 GPX', steps: ['選擇 GPX 檔案。', '檢查地點清單和參考線。', '查看路線設定，並尋找最多 3 條路線。', '選擇路線、查看完整地圖，再儲存 GPX。'] },
          'map-image': { label: '使用路線地圖圖片', steps: ['加入清晰的路線地圖圖片。', '用 Kimi 找出地圖位置和標記地點。', '選擇行程一定要經過的地點。', '比較路線、查看完整地圖，再儲存 GPX。'] },
          image: { label: '查看地圖圖片或相片', steps: ['加入清晰的地圖圖片或相片。', '用 Kimi 或相片 GPS 找出位置。', '選擇行程一定要經過的地點。', '比較路線、查看完整地圖，再儲存 GPX。'] }
        },
        prompts: {
          'add-map-pins': ['加入行程一定要經過的地點。', '按「開始加入圖釘」，再點按地圖。拖曳可移動圖釘；點按或右鍵可刪除。'],
          'focus-coordinates': ['每行輸入一個地點。', '先輸入緯度，再輸入經度。'],
          'preview-coordinates': ['可以顯示地點了。', '程式會把每組座標變成編號圖釘。'],
          'choose-text': ['選擇座標檔案。', '使用有緯度和經度的 TXT 或 CSV 檔案。'],
          'choose-gpx': ['選擇 GPX 檔案。', '匯入的路線只作參考。請檢查地點清單。'],
          'choose-image': ['加入清晰的地圖圖片。', '使用清晰截圖，或平放並光線充足的相片；地名和標記要看得清楚。'],
          'setup-recognition': ['尚未連接地圖識別。', '公開網頁需要你的私人 HTTPS 識別連線。你也可以改為輸入座標。'],
          'identify-image': ['請 Kimi 找出地圖和標記。', '先檢查連線，再自行開始識別。只有按下「識別」後，圖片才會傳送。'],
          'waiting-recognition': ['Kimi 正在閱讀地圖。', '請等候建議的地區和標記地點。程式不會自動加入任何地點。'],
          'review-candidates': ['檢查每個建議地點。', '加入行程一定要經過的地點，並修正錯誤座標。'],
          'add-photo-gps': ['找到相片位置。', '這可能只是拍攝位置，未必是地圖所示位置。請先檢查。'],
          'review-remove': ['地點太多，不能搜尋路線。', '請保留最多 16 個地點。程式不會自行刪除地點。'],
          'route-settings': ['檢查編號圖釘和路線設定。', '路線會經過每個地點，並在起點和終點附近尋找公共交通。'],
          'waiting-routes': ['正在尋找真正連接的步行路線。', '這可能需要一分鐘。程式不會虛構不存在的路。'],
          'compare-routes': ['比較路線選項。', '確認每個地點、起點和終點都合理，才選擇路線。'],
          'review-save': ['儲存前先查看完整路線。', '請查看行山當日的交通時間、山徑通行、封閉和實際情況。']
        },
        actions: {
          'add-map-pins': '開始加入圖釘',
          'focus-coordinates': '輸入我的地點', 'preview-coordinates': '顯示我的地點', 'choose-text': '選擇 TXT 或 CSV', 'choose-gpx': '選擇 GPX', 'choose-image': '加入地圖圖片', 'setup-recognition': '設定地圖識別', 'identify-image': '前往地圖識別', 'waiting-recognition': '正在閱讀地圖…', 'review-candidates': '檢查建議地點', 'add-photo-gps': '檢查相片位置', 'review-remove': '檢查並刪除地點', 'route-settings': '檢查設定並尋找路線', 'waiting-routes': '正在尋找路線…', 'compare-routes': '比較路線選項', 'review-save': '查看路線並儲存'
        },
        paste: '或從剪貼簿貼上', trace: '想準確複製彩色路線？使用圖片描線。', coordinatesInstead: '改為輸入座標',
        notes: {
          points: n => `已有 ${n} 個地點。搜尋路線時，程式會在已繪製的公共交通附近選擇起點和終點。`,
          trace: '這條描線尚未核實。搜尋路線只會使用兩個端點，不保證跟隨彩色路線。',
          gpx: 'GPX 軌跡只作參考。如果沒有航點，只有每段的第一點和最後一點會成為必經地點。',
          routes: '每個選項都使用已連接的地圖路徑，並經過所有必經地點。少於三個選項也可以。',
          selected: '這是暫定路線。行山前請查看即時交通、官方山徑通告、天氣和實際情況。'
        },
        safetyTitle: '為何這些步驟重要', officialTitle: '先選官方管理的山徑', officialCopy: '地圖上的小路也可能封閉、屬於私人地方或不安全。', transitTitle: '計劃如何前往和回家', transitCopy: '請查看行山當日的真實交通時間。', connectionsTitle: '不要猜測不存在的路', connectionsCopy: '如果找不到真正連接，程式會顯示較少路線。', privacy: '除非你選擇 Kimi 地圖識別，否則檔案只會留在這部裝置。',
        next: {
          empty: '第 1 步：加入行程一定要經過的每個地點。', tooMany: '搜尋路線最多可使用 16 個必經地點。請先刪除多出的地點。', ready: '第 3 步：檢查每個編號圖釘和設定，再尋找路線。', busy: '正在尋找已連接的地圖路徑，以及起點和終點的公共交通…', routes: '第 4 步：選擇路線，查看完整路徑和資料。', selected: '第 4 步：儲存前請查看完整路線、交通和山徑通行。'
        },
        mandatory: n => `${n} 個必經地點`, trackReference: '匯入的軌跡只作參考；只有清單內的地點是必經地點。', order: '保留現有次序，或為最多 8 個地點安排次序。', regions: { hk: '香港', tw: '台灣', jp: '日本', kr: '南韓', world: '其他地區' }
      }
    };

    let guideLanguage = 'en';
    try { const saved = localStorage.getItem(GUIDE_LANGUAGE_KEY); if (saved === 'zh-Hant') guideLanguage = saved; } catch {}
    let guideAction = 'focus-coordinates';
    const guideMethodOptions = Array.from($('input-method').options);
    const guideScroll = (id, focusId = id) => { revealControl(id); $(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $(focusId)?.focus({ preventScroll: true }), 350); };
    function guideEndpointReady() { try { return !!recognitionEndpoint(); } catch { return false; } }
    function guideModel() {
      return {
        method: $('input-method').value || 'map-pins', hasCoordinatesText: !!$('coordinates').value.trim(), hasImage: !!ai.image,
        hasRecognitionEndpoint: guideEndpointReady(), recognitionBusy: !!ai.controller, hasRecognitionResult: !!ai.result,
        hasPhotoGPS: !!state.photoGPS, pointCount: state.points.length, routingBusy: routing.busy,
        hasRoutes: !!routing.result, hasSelectedRoute: !!routing.selected
      };
    }
    function guideNote(copy, model) {
      if (model.hasSelectedRoute) return copy.notes.selected;
      if (model.hasRoutes) return copy.notes.routes;
      if (model.pointCount) return state.source === 'Image trace — unverified' ? copy.notes.trace : copy.notes.points(model.pointCount);
      if (model.method === 'gpx') return copy.notes.gpx;
      return copy.prompts[guideAction][1];
    }
    function updateInputGuide() {
      const copy = guideCopy[guideLanguage], model = guideModel(), status = guideStateFor(model), method = copy.methods[model.method]; guideAction = status.action;
      $('method-guide').lang = guideLanguage; $('next-action').lang = guideLanguage; $('guide-title').textContent = copy.title; $('guide-language-label').textContent = copy.language; $('guide-language').textContent = copy.switchLanguage;
      $('guide-step').textContent = `${status.step}/4`; $('guide-method').textContent = `${method.label} · ${copy.stepOf(status.step)}`; const prompt = copy.prompts[status.action][0]; if ($('guide-prompt').textContent !== prompt) $('guide-prompt').textContent = prompt; $('guide-note').textContent = guideNote(copy, model);
      const steps = document.createDocumentFragment(); method.steps.forEach((text, index) => { const item = element('li', text); item.dataset.step = String(index + 1); if (index < status.step - 1) item.className = 'done'; if (index === status.step - 1) { item.className = 'current'; item.setAttribute('aria-current', 'step'); } steps.append(item); }); $('guide-list').replaceChildren(steps);
      $('guide-action').textContent = copy.actions[status.action]; $('guide-action').disabled = status.action.startsWith('waiting-');
      const secondary = $('guide-secondary'); secondary.hidden = false;
      if (model.method === 'map-image' && !model.hasImage) { secondary.textContent = copy.paste; secondary.dataset.action = 'paste'; }
      else if (model.method === 'map-image' && model.hasImage) { secondary.textContent = copy.trace; secondary.dataset.action = 'trace'; }
      else if (['image', 'map-image'].includes(model.method) && status.action === 'setup-recognition') { secondary.textContent = copy.coordinatesInstead; secondary.dataset.action = 'coordinates'; }
      else { secondary.hidden = true; secondary.textContent = ''; secondary.dataset.action = ''; }
      $('guide-safety-title').textContent = copy.safetyTitle; $('guide-official-title').textContent = copy.officialTitle; $('guide-official-copy').textContent = copy.officialCopy; $('guide-transit-title').textContent = copy.transitTitle; $('guide-transit-copy').textContent = copy.transitCopy; $('guide-connections-title').textContent = copy.connectionsTitle; $('guide-connections-copy').textContent = copy.connectionsCopy; $('guide-privacy').textContent = copy.privacy;
      guideMethodOptions.forEach(option => { if (option.value) option.textContent = copy.methods[option.value].label; });
      const nextKey = routing.selected ? 'selected' : routing.result ? 'routes' : routing.busy ? 'busy' : state.points.length > 16 ? 'tooMany' : state.points.length ? 'ready' : 'empty';
      const details = `${copy.regions[activeRegion()]} · ${copy.mandatory(state.points.length)}. ${state.segments.length ? copy.trackReference : copy.order}`;
      const nextStrong = element('strong', copy.next[nextKey]), nextDetails = element('p', details);
      if ($('next-action').textContent !== nextStrong.textContent + nextDetails.textContent) $('next-action').replaceChildren(nextStrong, nextDetails);
    }
    function runGuideAction() {
      const action = guideAction;
      if (action === 'add-map-pins') return $('start-pin-mode').click();
      if (action === 'focus-coordinates') return guideScroll('planner', 'coordinates');
      if (action === 'preview-coordinates') return $('preview-points').click();
      if (action === 'choose-text' || action === 'choose-gpx' || action === 'choose-image') return $('file-input').click();
      if (action === 'setup-recognition') { $('ai-connection').open = true; return guideScroll('ai-review', 'ai-endpoint'); }
      if (action === 'identify-image') return guideScroll('ai-review', 'recognize-map');
      if (action === 'review-candidates') { const target = $('ai-candidates').querySelector('input, button'); guideScroll('ai-results'); if (target) setTimeout(() => target.focus({ preventScroll: true }), 350); return; }
      if (action === 'add-photo-gps') return guideScroll('image-review', 'add-photo-gps');
      if (action === 'review-remove') return guideScroll('route-builder', 'waypoints');
      if (action === 'route-settings') return guideScroll('route-builder', 'plan-region');
      if (action === 'compare-routes') return guideScroll('route-results', 'route-options');
      if (action === 'review-save') return guideScroll('map-title', 'map-title');
    }
    $('guide-language').addEventListener('click', () => { guideLanguage = guideLanguage === 'en' ? 'zh-Hant' : 'en'; try { localStorage.setItem(GUIDE_LANGUAGE_KEY, guideLanguage); } catch {} updateInputGuide(); });
    $('guide-action').addEventListener('click', runGuideAction);
    $('guide-secondary').addEventListener('click', () => { const action = $('guide-secondary').dataset.action; if (action === 'paste') $('paste-map').click(); else if (action === 'trace') guideScroll('image-converter', 'trace-canvas'); else if (action === 'coordinates') { $('input-method').value = 'coordinates'; $('input-method').dispatchEvent(new Event('change')); guideScroll('planner', 'coordinates'); } });
    $('coordinates').addEventListener('input', updateInputGuide);
    updateInputGuide();
    // END GUIDANCE UI
