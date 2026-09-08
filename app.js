	/* showNotification - displays "from backend: " + text for 3 seconds */
	


	/* postMessage fallback (use origin check in production) */
	window.addEventListener('message', function(ev) {
	  // IMPORTANT: in production replace '*' below with allowed origin and check ev.origin  	  
    console.log('message received', ev.origin, ev.data);
    
	  var data = ev.data || {};
	  try {
		if (data && data.type === 'search') {
		  //window.showNotification(data.text);
		  window.sitesearch(data.text);
		}
	  } catch (e) { /* ignore malformed messages */ }
	}, false);



  window.sitesearch = async function searchsite2(text) {
      const term = (text || '').trim().toLowerCase();


      try {
        // 1) primary: search active DB
        let matches = await db.sites
          .filter(function(s){
            // defensive: ensure properties exist
            const sid = (s.siteId || '').toString().toLowerCase();
            const sname = (s.sitename || '').toString().toLowerCase();
            return sid.indexOf(term) !== -1 || sname.indexOf(term) !== -1;
          })
          .toArray();


        allMatches = matches || [];

        if (allMatches.length === 0) {
          resultsList.innerHTML    = '<li>No results</li>';
          paginationDiv.innerHTML  = '';
          showSearchResultsAtPanel();
          return 'site not found';
        }

        if (allMatches.length === 1) {
          const site = allMatches[0];
          map.setView([site.lat, site.lon], +zoomSlider.value);
          site.azimuths = (String(site.azRaw || '')).split(';')
                            .map(Number).filter(function(n){return !isNaN(n);});
          currentSites = [site];
          drawAllSectors();

          sr.style.display = 'none';
          //setPanelCollapsed(false);
          return 'site found';
        }

        // multiple matches -> render list (existing behaviour)
        currentPage = 1;
        renderResults();

      } catch (err) {
        console.error('search error', err);
        resultsList.innerHTML = '<li>Error</li>';
        paginationDiv.innerHTML = '';
        showSearchResultsAtPanel();
      }

      return 'ok'

    };





	  const LOCAL_DATA_URL = 'sites.json';
      


    (function(){
      const KEY = 'lastDataFetch_v1';
      const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
      const now = Date.now();
      const prevTs = parseInt(localStorage.getItem(KEY), 10) || 0;
      const shouldFetch = !prevTs || (now - prevTs) > TWELVE_HOURS_MS;
      const badge = document.getElementById('perfBadge');

      function saveNow() {
        try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* ignore */ }
      }

      if (shouldFetch) {
        (async function fetchParallel() {
          let allData = [];
          const chunkSize = 10000;
          const maxConcurrent = 3; 
          const posturl = 'https://map3.dhani-wijaya-nokia.workers.dev/';

          try {
            if (badge) {
              badge.style.background = 'rgba(0,122,255,0.8)';
              badge.textContent = 'initializing streams...';
            }

            const maxRes = await fetch(posturl, {
              method: 'POST',
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: 'get_max_id' })
            });
            const maxData = await maxRes.json();
            const maxId = maxData.maxId || 0;
            if (maxId === 0) throw new Error('Failed to retrieve boundary limits');

            const chunks = [];
            for (let i = 0; i <= maxId; i += chunkSize) {
              chunks.push({ minId: i, maxId: i + chunkSize });
            }

            // Retry helper with exponential backoff
            const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
              for (let i = 0; i < retries; i++) {
                try {
                  const res = await fetch(url, options);
                  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                  return await res.json();
                } catch (e) {
                  if (i === retries - 1) throw e;
                  console.warn(`Chunk failed, retrying in ${delay * Math.pow(2, i)}ms...`, e);
                  await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
                }
              }
            };

            for (let i = 0; i < chunks.length; i += maxConcurrent) {
              const batch = chunks.slice(i, i + maxConcurrent);
              
              const promises = batch.map((c) => {
                return fetchWithRetry(posturl, {
                  method: 'POST',
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: 'ndball', minId: c.minId, maxId: c.maxId })
                });
              });

              const batchResults = await Promise.all(promises);
              for (const resArray of batchResults) {
                if (Array.isArray(resArray)) allData = allData.concat(resArray);
              }
              
              if (badge) {
                badge.textContent = `downloading.. ${allData.length}`;
              }
            }

            try { await DataUpdate(allData); } catch (e) { console.error('DataUpdate error', e); }
            saveNow();

          } catch (err) {
            console.error('fetch failure:', err);
            if (badge) {
              badge.style.background = 'rgba(150,0,0,0.8)';
              badge.textContent = 'fetch failed';
              setTimeout(() => { badge.textContent = ''; }, 5000);
            }
          }
        })();
      } else {
        if (badge) {
          badge.style.background = 'rgba(0,0,0,0.5)';
          badge.textContent = 'all good';
          setTimeout(() => { badge.textContent = ''; }, 5000);
        }
      }
    })();

    


 
      
    // create map object (no setView yet)
    let map = L.map('map', { zoomControl: false });

    // create the layers that can attach to the map now
    const sectorLayer = L.layerGroup().addTo(map);      // for permanent/normal sectors
    const tempSectorLayer = L.layerGroup().addTo(map);  // for temporary/loading sectors
    /* --- UI state save/load (minimal IndexedDB) --- */
    const _uiDBName = 'NDB_UI_Settings_v1';
    const _uiStoreKey = 'ui';

    // load saved UI (IndexedDB) and set center BEFORE adding tile layer so tiles load at correct place
    let currentLayer;
    (async function initMapTilesAndCenter(){
      const DEFAULT_CENTER = [-7.289322, 112.676023];
      const DEFAULT_ZOOM = 16;

      try {
        // loadUISettings() is already defined elsewhere in your file and returns saved settings object
        const s = await loadUISettings();        
        if (!s) {
          map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        }
      } catch (e) {
        console.warn('Could not load saved center, using default:', e);
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      }

      // now add the tile layer (tiles will request for the current/map view)
      currentLayer = L.tileLayer(
        'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        { subdomains:['mt0','mt1','mt2','mt3'], attribution:'Google', maxZoom:20, unloadInvisibleTiles: false, updateWhenIdle: true, keepBuffer: 2 }
      ).addTo(map);
    })();

      
    // 2. Hook up the selector
    document.getElementById('mapTypeSelect').addEventListener('change', e => {
      const lyrs = e.target.value;              // 'm'|'s'|'y'
      map.removeLayer(currentLayer);
      
      const url = 
      'https://{s}.google.com/vt/lyrs=' + lyrs +
      '&x={x}&y={y}&z={z}';
      currentLayer = L.tileLayer(url, {
        subdomains:['mt0','mt1','mt2','mt3'],
        attribution:'Google',
        maxZoom:20,unloadInvisibleTiles: false, updateWhenIdle: true, keepBuffer: 2
      }).addTo(map);
      
    });
    

  const controlPanel = document.getElementById('controlPanel');
  const themeSelect=document.getElementById('themeSelect'), measureToggle=document.getElementById('measureToggle');
  const searchInput=document.getElementById('searchInput'), searchBtn=document.getElementById('searchBtn');
  const gotoInput=document.getElementById('gotoInput'), gotoBtn=document.getElementById('gotoBtn');
  const coordDisplay=document.getElementById('coordDisplay'), contextMenu=document.getElementById('contextMenu');
  const infoPopup=document.getElementById('infoPopup'), infoClose=document.getElementById('infoClose');
  const zoomSlider=document.getElementById('zoomSlider'), rangeSlider=document.getElementById('rangeSlider');
	const toggleSiteId = document.getElementById('toggleSiteId'), toggleSiteName = document.getElementById('toggleSiteName');
	const toggleAlwaysShow = document.getElementById('toggleAlwaysShow');
	const toggleSectors = document.getElementById('toggleSectors');
	const badge = document.getElementById('perfBadge');
	const clearAllBtn = document.getElementById('clearAllBtn');
	const clearPointsBtn = document.getElementById('clearPointsBtn');

  /* ===========================
    URL args support
    Supports: q / search, center, zoom, goto
    Behavior:
    - search: try immediately if DB has rows; otherwise poll until DB ready then run
    - goto: create markers stored in pointMarkers[] (same as Clear Points)
    =========================== */

  // // Helper: robust getter for URLSearchParams or plain object
  // function _getParamFrom(params, key) {
  //   if (!params) return null;
  //   if (typeof params.get === 'function') return params.get(key);
  //   if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
  //   // case-insensitive fallback
  //   const found = Object.keys(params).find(k => k.toLowerCase() === key.toLowerCase());
  //   return found ? params[found] : null;
  // }

  // Helper: robust getter for URLSearchParams or plain object for local html or GAS environment
  function _getParamFrom(src, key) {
    if (!src || !key) return undefined;

    const lowerKey = key.toLowerCase();

    // case 1: if src is URLSearchParams
    if (typeof src.get === 'function') {
      // try exact first
      const v1 = src.get(key);
      if (v1 !== null) return v1;

      // try lowercase key
      const v2 = src.get(lowerKey);
      return v2 !== null ? v2 : undefined;
    }

    // case 2: if src is plain object ({ goto:"...", zoom:"..." })
    if (typeof src === 'object') {
      // exact key
      if (key in src) return src[key];

      // case-insensitive scan (common in GAS params)
      for (const k in src) {
        if (k.toLowerCase() === lowerKey) {
          return src[k];
        }
      }
    }

    return undefined;
  }

  // Wait until DB has at least one row (polling). timeoutMs default 60000.
  function waitForDBRows(timeoutMs = 60000, intervalMs = 500) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        try {
          if (typeof db !== 'undefined' && db && db.sites) {
            db.sites.count().then(cnt => {
              if (cnt > 0) return resolve(true);
              if (Date.now() - start >= timeoutMs) return resolve(false);
              setTimeout(poll, intervalMs);
            }).catch(() => {
              if (Date.now() - start >= timeoutMs) return resolve(false);
              setTimeout(poll, intervalMs);
            });
          } else {
            if (Date.now() - start >= timeoutMs) return resolve(false);
            setTimeout(poll, intervalMs);
          }
        } catch (e) {
          if (Date.now() - start >= timeoutMs) return resolve(false);
          setTimeout(poll, intervalMs);
        }
      })();
    });
  }

  // Trigger existing search UI safely
  async function runSearchTerm(term, optZoom) {
    if (!term) return;
    // if DB ready run immediately; otherwise wait then run
    try {
      const hasRows = (typeof db !== 'undefined' && db && db.sites)
        ? (await db.sites.count()) > 0
        : false;

      if (!hasRows) {
        // wait for DB rows (max 60s)
        const ok = await waitForDBRows(60000, 500);
        if (!ok) {
          console.warn('runSearchTerm: DB not ready within timeout, postponing search');
          return;
        }
      }
    } catch (e) {
      console.warn('runSearchTerm: error checking DB readiness', e);
      // continue and try search against whatever is available
    }

    try {
      if (typeof searchInput !== 'undefined') searchInput.value = term;
      // apply zoom if provided
      if (optZoom !== undefined && !Number.isNaN(Number(optZoom))) {
        const z = Number(optZoom);
        try { map.setView(map.getCenter(), z); zoomSlider.value = z; } catch (e) {}
      }
      if (typeof searchBtn !== 'undefined') {
        try { searchBtn.click(); }
        catch (e) {
          if (typeof searchBtn.onclick === 'function') searchBtn.onclick();
        }
      }
    } catch (e) {
      console.error('runSearchTerm failed', e);
    }
  }

  // Add goto markers from a string (coordinates). Stores markers in pointMarkers[].
  function addGotoMarkersFromString(text) {
    if (!text) return;
    // extract numbers
    const nums = (String(text).match(/-?\d+\.?\d*/g) || []).map(Number);
    if (!nums.length) return;

    const newMarkers = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const a = nums[i], b = nums[i + 1];
      // determine lat vs lon heuristically (if one magnitude > 90 it's lon)
      let lat = Math.abs(a) <= 90 && Math.abs(b) > 90 ? a : b;
      let lon = lat === a ? b : a;

      // If invalid coords skip
      if (!isFinite(lat) || !isFinite(lon)) continue;

      // build label HTML (mimic old behaviour)
      const idx = pointMarkers.length + newMarkers.length + 1;
      const size = Math.round((currentTextSize || 13) * 1.5);
      const html =
        '<span style="font-size:' + size + 'px; -webkit-text-stroke:1px white; text-stroke:3px black; color:red; text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;">' +
          '<span class="blinking">★</span>' + idx +
        '</span>';

      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'no-bg',
          html: html,
          iconAnchor: [0, 0]
        })
      }).addTo(map);

      // reuse your existing pointMarkers array
      pointMarkers.push(marker);
      newMarkers.push(marker);

      // attach context menu handlers if you already do similar for points
      (function(m) {
        m.on && m.on('contextmenu', function(e) {
          // preserve your existing context behavior by firing the same events
          // For now we just show the map context if you have showContext
          if (typeof showContext === 'function') try { showContext(e, true); } catch(e){/*ignore*/ }
        });
      })(marker);
    }

    // Move / zoom to new markers
    if (newMarkers.length === 0) return;
    if (newMarkers.length === 1) {
      try { map.flyTo(newMarkers[0].getLatLng(), map.getMaxZoom(), { animate: true, duration: 2 }); }
      catch (e) { try { map.setView(newMarkers[0].getLatLng(), map.getMaxZoom()); } catch(_){} }
    } else {
      try {
        const bounds = L.latLngBounds(newMarkers.map(m => m.getLatLng()));
        map.fitBounds(bounds, { padding: [20, 20], animate: true, duration: 2 });
      } catch (e) { /* ignore fit failure */ }
    }
  }

  // The main function which applies params (URLSearchParams or plain object)
  function applyURLArgsFromParams(params) {
    const getParam = (k) => _getParamFrom(params, k);
    console.log(getParam);

    const q = getParam('q') || getParam('search');
    const center = getParam('center');
    const zoom = getParam('zoom');
    const goto = getParam('goto');
    console.log('goto=',goto);
    

    // 1) center + optional zoom (apply immediately)
    if (center) {
      const parts = String(center).split(',').map(s => parseFloat(s.trim())).filter(n => !Number.isNaN(n));
      if (parts.length === 2) {
        const lat = parts[0], lon = parts[1];
        const z = (zoom && !Number.isNaN(Number(zoom))) ? Number(zoom) : (+zoomSlider.value || map.getZoom());
        try { map.setView([lat, lon], z); zoomSlider.value = z; } catch(e) { console.warn('applyURLArgs center failed', e); }
      }
    }

    // 2) search q/search: run now if DB has rows; otherwise wait for DB then run
    if (q) {
      runSearchTerm(q, zoom);
    }

    // 3) goto: add markers (store in pointMarkers[])
    if (goto) {
      // if goto contains semicolons or spaces with multiple coords, handle all
      try {
        addGotoMarkersFromString(goto);
      } catch (e) {
        console.error('applyURLArgsFromParams goto failed', e);
      }
    }
  }

  // Auto-run on page load: parse URL and apply args
  // (Call this after you created UI elements but it's safe to call multiple times)
  function applyURLArgsFromLocation() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      applyURLArgsFromParams(params);
    } catch (e) {
      // fallback: parse as query string manually
      try {
        const s = window.location.search || '';
        const obj = {};
        s.replace(/^\?/, '').split('&').forEach(p => {
          if (!p) return;
          const kv = p.split('=');
          const k = decodeURIComponent(kv[0]||'');
          const v = decodeURIComponent((kv[1]||''));
          obj[k] = v;
        });
        applyURLArgsFromParams(obj);
      } catch (e2) {
        console.warn('applyURLArgsFromLocation failed', e2);
      }
    }
  }


  


  // --- show greeting;
  // let loadingLabel = document.getElementById('loadingLabel');
  // if (!loadingLabel) {
  //   loadingLabel = document.createElement('div');
  //   loadingLabel.id = 'loadingLabel';
  //   document.body.appendChild(loadingLabel);
  // }
  // --- dynamic message by time ---
  const hour = new Date().getHours();
  let msg = 'loading visible sites…'; // fallback

  if (hour >= 4 && hour < 7) {
    msg = 'wih pagi2 udah kerja.. semangat kk..';
  } else if (hour >= 7 && hour < 10) {
    msg = 'pagi kk..';
  } else if (hour >= 10 && hour < 14) {
    msg = 'siang kk..';
  } else if (hour >= 14 && hour < 16) {
    msg = 'siang kk.. udah makan blm nih?';
  } else if (hour >= 16 && hour < 18) {
    msg = 'semangat kk..';
  } else if (hour >= 18 && hour < 22) {
    msg = 'udah kk..isitrahat dulu';
  } else {
    // covers 22:00–24:00 and 0:00–4:00
    msg = 'ya ampun kk.. masih kerja aja nih?';
  }

  // // loadingLabel.textContent = msg;
  // // loadingLabel.style.display = 'block';

  // badge.style.background = 'rgba(0,0,0,0.5)';
  // badge.textContent = msg;
  
  // setTimeout(() => {
  //   // loadingLabel.style.display = 'none';
  //   badge.style.background = 'rgba(0,122,255,0.8)'
  //   badge.textContent = '';
  // }, 5000);    

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  (async () => {
    try {
      if (badge.textContent === 'all good'){
        await sleep(5000); // wait 5 seconds
        badge.style.background = 'rgba(0,0,0,0.5)';
        badge.textContent = msg;

        await sleep(5000); // wait 5 seconds

        badge.style.background = 'rgba(0,122,255,0.8)';
        badge.textContent = '';        
      } else{

        badge.style.background = 'rgba(0,0,0,0.5)';
        badge.textContent = msg;

        await sleep(5000); // wait 5 seconds

        badge.style.background = 'rgba(0,122,255,0.8)';
        badge.textContent = 'nunggu respon dulu';
      }
    } catch (err) {
      console.error('badge delay error', err);
    }
  })();



  // ---------- add: helper to disable/enable sliders during loading/ISD ----------
  function setInteractiveSliders(enabled) {
    try {
      // disable/enable form controls
      rangeSlider.disabled = !enabled;
      textSizeSlider.disabled = !enabled;
      // subtle visual cue
      rangeSlider.style.opacity = enabled ? '' : '0.45';
      textSizeSlider.style.opacity = enabled ? '' : '0.45';
    } catch (e) {
      // defensive: if elements not available yet, ignore
      console.warn('setInteractiveSliders: elements missing', e);
    }
  }





	(function(){
		var cp  = document.getElementById('controlPanel'),
			win = window,
			inputs = [
				document.getElementById('gotoInput'),
				document.getElementById('searchInput')
			];

		inputs.forEach(function(el){
			// get original computed width as px-string and number
			var origStr = win.getComputedStyle(el).width;             // MDN:getComputedStyle
			var origNum = parseFloat(origStr);
			el.style.whiteSpace = 'pre';                              // MDN:white-space
			var handler;

			el.addEventListener('focus', function(){
			handler = function(){
				var need = el.scrollWidth + 10;                       // MDN:scrollWidth
				// don't shrink below origNum; cap at viewport
				var panelLeft = cp.getBoundingClientRect().left;
				var max     = win.innerWidth - panelLeft - 20;
				var growTo  = Math.max(origNum, need);
				// el.style.width = Math.min(growTo, max) + 'px';
			};
			handler();
			el.addEventListener('input', handler, false);
			el.addEventListener('paste', handler, false);
			}, false);

			el.addEventListener('blur', function(){
			el.removeEventListener('input', handler, false);
			el.removeEventListener('paste', handler, false);
			// el.style.width = origStr;
			}, false);
		});
		})();

	clearPointsBtn.addEventListener('click', () => {
		// gotoInput.value = '';
		clearPoints();   // your existing function that removes all pointMarkers
		
	});

	let pointMarkers = [];
	// Clear existing points
	function clearPoints() {
	  pointMarkers.forEach(m => map.removeLayer(m));
	  pointMarkers = [];
	}
	
	// current label font size (px)
	let currentTextSize = 13;
	const textSizeSlider = document.getElementById('textSizeSlider');

	textSizeSlider.addEventListener('input', e => {
	  currentTextSize = +e.target.value;
	  // instantly reflect on existing labels:
	  drawAllSectors();
	});

//related to window of search result
  // 3) Grab elements & paging constants
  var searchResultsDiv = document.getElementById('searchResults');
  var resultsList      = searchResultsDiv.querySelector('ul');
  var paginationDiv    = searchResultsDiv.querySelector('.pagination');

  var PAGE_SIZE  = 8;
  var MAX_PAGES  = 5;
  var allMatches = [];
  var currentPage = 1;

  var ctrl   = document.getElementById('controlPanel');
  var bottom = document.getElementById('bottomBar');
  var sr     = searchResultsDiv;
  let audioCtx = null;
  let hoverEnabled = true; 

  function positionSearchResults() {
    // anchor under control panel and match its width
    var rect     = ctrl.getBoundingClientRect();
    var topY     = rect.bottom + 0;
    var bottomY  = window.innerHeight - bottom.getBoundingClientRect().top + 0;
    var width    = ctrl.clientWidth;    

  //console.log('positionsearchresult1');
    // apply inline styles (overrides any CSS left/right defaults)
    sr.style.top    = topY + 'px';
    sr.style.bottom = 'auto'; 
    sr.style.width  = width + 'px';
    sr.style.left   = rect.left + 'px';  
    sr.style.right  = 'auto';

  }

  function showSearchResultsAtPanel() {
    // capture rect first (so we know the physical coordinates)
    const rect = ctrl.getBoundingClientRect();

    // collapse/hide the panel (this shows the FAB too)
    setPanelCollapsed(true);
    //console.log('showsearchresult1');
    // show and position the searchResults to match the panel's rect
    sr.style.display = 'block';
    sr.style.top    = rect.top + 'px';
    sr.style.left   = rect.left + 'px';
    sr.style.width  = rect.width + 'px';
    sr.style.bottom = 'auto';
    sr.style.right  = 'auto';
  }


  window.addEventListener('resize', positionSearchResults);
  document.addEventListener('DOMContentLoaded', positionSearchResults);

  // 4) Replace searchBtn handler
    // search — fallback to tempMemory when streaming
    searchBtn.onclick = async function() {
      const term = (searchInput.value || '').trim().toLowerCase();
      if (!term) {
        sr.style.display = 'none';
        setPanelCollapsed(false);
        return;
      }

      try {
        // 1) primary: search active DB
        let matches = await db.sites
          .filter(function(s){
            // defensive: ensure properties exist
            const sid = (s.siteId || '').toString().toLowerCase();
            const sname = (s.sitename || '').toString().toLowerCase();
            return sid.indexOf(term) !== -1 || sname.indexOf(term) !== -1;
          })
          .toArray();


        allMatches = matches || [];

        if (allMatches.length === 0) {
          resultsList.innerHTML    = '<li>No results</li>';
          paginationDiv.innerHTML  = '';
          showSearchResultsAtPanel();
          return;
        }

        if (allMatches.length === 1) {
          const site = allMatches[0];
          map.setView([site.lat, site.lon], +zoomSlider.value);
          site.azimuths = (String(site.azRaw || '')).split(';')
                            .map(Number).filter(function(n){return !isNaN(n);});
          currentSites = [site];
          drawAllSectors();

          sr.style.display = 'none';
          setPanelCollapsed(false);
          return;
        }

        // multiple matches -> render list (existing behaviour)
        currentPage = 1;
        renderResults();

      } catch (err) {
        console.error('search error', err);
        resultsList.innerHTML = '<li>Error</li>';
        paginationDiv.innerHTML = '';
        showSearchResultsAtPanel();
      }
    };


  // 5) Render function
  function renderResults() {
    var start     = (currentPage - 1) * PAGE_SIZE;
    var pageItems = allMatches.slice(start, start + PAGE_SIZE);

    // build list via string-concat
    var html = '';
    for (var i = 0; i < pageItems.length; i++) {
      const t = (s, n=18) => (s && s.length>n) ? s.slice(0,n-2)+'..' : (s||'');
      var sid = pageItems[i].siteId || '';
      var sname = pageItems[i].sitename || '';
      html += '<li class="result-row" data-index="' + (start + i) + '" data-siteid="' + sid.replace(/"/g,'&quot;') + '">' +
              '<span class="siteid">' + sid + '</span>' +
              (sname ? ' <span class="sitename">' + t(sname) + '</span>' : '') +
              '</li>';
    }
    resultsList.innerHTML = html;

    // pagination
    var totalPages = Math.min(
      Math.ceil(allMatches.length / PAGE_SIZE),
      MAX_PAGES
    );
    var pagHtml = '';
    for (var p = 1; p <= totalPages; p++) {
      pagHtml += '<span class="' +
                (p === currentPage ? 'active' : '') +
                '" data-page="' + p + '">' +
                p +
                '</span>';
    }
    paginationDiv.innerHTML = pagHtml;

    // show window
    showSearchResultsAtPanel();



    // safer binding for search-result list items
    const lis = resultsList.children;
    for (let j = 0; j < lis.length; j++) {
      const li = lis[j];
      const idx = Number(li.getAttribute('data-index'));
      if (Number.isNaN(idx)) continue; // defensive

      // hover only when hoverEnabled
      li.addEventListener('pointerenter', function () {
        if (!hoverEnabled) return;
        li.classList.add('hovered');
        if (allMatches && allMatches[idx]) renderHoverSite(allMatches[idx]);
      });

      // leave: remove hovered unless pinned
      li.addEventListener('pointerleave', function () {
        if (li.classList.contains('pinned')) return;
        li.classList.remove('hovered');
      });

      // click toggles pin state
      li.addEventListener('click', function (e) {
        const alreadyPinned = li.classList.contains('pinned');

        if (alreadyPinned) {
          // unpin
          li.classList.remove('pinned');
          li.classList.remove('hovered');
          hoverEnabled = true;
          if (allMatches && allMatches[idx]) renderClickSite(allMatches[idx]);
          // hide results and restore panel
          sr.style.display = 'none';
          setPanelCollapsed(false);
        } else {
          // pin this one and unpin others
          Array.from(resultsList.children).forEach(x => x.classList.remove('pinned', 'hovered'));
          li.classList.add('pinned');
          hoverEnabled = false;
          if (allMatches && allMatches[idx]) renderClickSite(allMatches[idx]);
          // show results over the panel
          showSearchResultsAtPanel();
        }

        e.stopPropagation();
      });
    }


    // bind pagination clicks
    var spans = paginationDiv.children;
    for (var k = 0; k < spans.length; k++) {
      (function(pg){
        var span = spans[pg];
        span.addEventListener('click', function(e){
          e.stopPropagation();
          currentPage = +this.getAttribute('data-page');
          renderResults();
        });
      })(k);
    }
  }


    document.addEventListener('click', e => {
      // only auto-hide search results when hoverEnabled is true
      if (hoverEnabled) {
        if (!searchResultsDiv.contains(e.target) && e.target !== searchBtn) {
          sr.style.display = 'none';
          //setPanelCollapsed(false);          
          // also unpin any pinned rows (defensive)
          Array.from(resultsList.children).forEach(x => x.classList.remove('pinned'));
        }
      } else {
        // when pinned (hoverEnabled === false), ignore outside clicks for hiding.
        // you may optionally add logic here to unpin on some special click (not implemented).
      }

      if (!audioCtx) {
        audioCtx = new AudioContext();
        audioCtx.resume();
      }
    });

  
    // ---- replace existing renderHoverSite with this ----
    let _hoverTimer = null;
    let _lastHoverSiteId = null;

    function renderHoverSite(site) {
      // debounce quick repeated hovers
      if (!site || !site.siteId) return;
      _lastHoverSiteId = site.siteId;
      if (_hoverTimer) clearTimeout(_hoverTimer);

      _hoverTimer = setTimeout(async () => {
        // make sure this is still the latest hovered site
        if (_lastHoverSiteId !== site.siteId) return;

        // normalize azimuths (existing behavior)
        if (typeof site.azRaw === 'number') {
          site.azimuths = [ site.azRaw ];
        } else {
          const raw = String(site.azRaw || '');
          site.azimuths = raw.split(';').map(n => parseFloat(n)).filter(n => !isNaN(n));
        }

        // defensive coords
        const lat = Number(site.lat);
        const lon = Number(site.lon);
        if (!isFinite(lat) || !isFinite(lon)) {
          console.warn('renderHoverSite: invalid coords for', site.siteId);
          return;
        }

        // If ISD exists, compute bbox and fit; otherwise do a simple pan/zoom.
        const rawIsd = Number(site.ISD);
        const isdKm = (isFinite(rawIsd) && rawIsd > 0) ? rawIsd : null;

        // stop any ongoing animations so the next command is applied cleanly
        try { if (map && map._panAnim) map._panAnim.stop(); } catch(e){}

        // remove previous transient moveend handler (if any)
        if (renderHoverSite.__moveEndHandler) {
          try { map.off('moveend', renderHoverSite.__moveEndHandler); } catch(e){}
          delete renderHoverSite.__moveEndHandler;
        }

        if (isdKm) {
          // multiplier = k × ISD to each side (as requested)
          const halfExtentKm = isdKm * 1;
          try {
            const north = turf.destination([lon, lat], halfExtentKm,   0, { units: 'kilometers' }).geometry.coordinates;
            const east  = turf.destination([lon, lat], halfExtentKm,  90, { units: 'kilometers' }).geometry.coordinates;
            const south = turf.destination([lon, lat], halfExtentKm, 180, { units: 'kilometers' }).geometry.coordinates;
            const west  = turf.destination([lon, lat], halfExtentKm, 270, { units: 'kilometers' }).geometry.coordinates;

            const lats = [ north[1], east[1], south[1], west[1] ];
            const lons = [ north[0], east[0], south[0], west[0] ];
            const minLat = Math.min.apply(null, lats);
            const maxLat = Math.max.apply(null, lats);
            const minLon = Math.min.apply(null, lons);
            const maxLon = Math.max.apply(null, lons);

            const bounds = [[minLat, minLon], [maxLat, maxLon]];

            // Wait for moveend to draw so drawAllSectors doesn't race and trigger other behaviors
            renderHoverSite.__moveEndHandler = function() {
              // only draw if the hovered site remains the same
              if (_lastHoverSiteId === site.siteId) {
                currentSites = [site];
                drawAllSectors();
              }
              // cleanup
              map.off('moveend', renderHoverSite.__moveEndHandler);
              delete renderHoverSite.__moveEndHandler;
            };
            map.once('moveend', renderHoverSite.__moveEndHandler);

            // fit bounds (no immediate setView before this)
            map.fitBounds(bounds, { padding: [20,20], animate: true, maxZoom: 18 });

          } catch (err) {
            console.warn('renderHoverSite: turf destination failed — fallback to setView', err);
            // fallback to simple centering
            currentSites = [site];
            map.setView([lat, lon], +zoomSlider.value);
            drawAllSectors();
          }
        } else {
          // no ISD: behave like normal single-site pan/zoom, but still debounce
          currentSites = [site];
          map.setView([lat, lon], +zoomSlider.value);
          drawAllSectors();
        }
      }, 120); // 120ms debounce — adjust if you want faster/slower responsiveness
    }

  function renderClickSite(site) {
      if (typeof site.azRaw === 'number') {
      // single numeric value → treat as one “sector”
      site.azimuths = [ site.azRaw ];
      } else {
      // now safely coerce to string:
      const raw = String(site.azRaw||'');
      site.azimuths = raw
        .split(';')
        .map(n => parseFloat(n))
        .filter(n => !isNaN(n));
      }
    
      map.setView([site.lat, site.lon], +zoomSlider.value);
      currentSites = [site];
      drawAllSectors();

  }

  // 1) Clear all button
  clearAllBtn.addEventListener('click', function() {
    // clear drawn sectors & markers
    clearSectors();
    // reset model
    currentSites = [];
    // hide search window if open
    sr.style.display = 'none';
    setPanelCollapsed(false);
  });

  // 2) Redraw on toggleSectors change
  toggleSectors.addEventListener('change', drawAllSectors);

  // 3) Redraw when toggleSiteId or toggleSiteName change
  var toggles = [toggleSiteId, toggleSiteName];
  for (var i = 0; i < toggles.length; i++) {
    toggles[i].addEventListener('change', function() {
      drawAllSectors();
    });
  }

  const ISD_MULTIPLIER = 10;
  const MIN_ZOOM_LEVEL = 10;

  function updateVisibleSites() {
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    
    // Check toggle and hard zoom cutoff before DB query
    if (!toggleAlwaysShow.checked || map.getZoom() < MIN_ZOOM_LEVEL) {
      clearSectors();
      currentSites = [];
      return;
    }

    // When not streaming, fall back to DB query (original logic)
    db.sites
      .where('lat').between(b.getSouth(), b.getNorth())
      .and(function(s) {
        return s.lon >= b.getWest() && s.lon <= b.getEast();
      })
      .toArray()
      .then(function(rows) {
        
        // Calculate max ISD and dynamic diagonal cutoff
        if (rows.length > 0) {
          const screenDiagonalKm = b.getSouthWest().distanceTo(b.getNorthEast()) / 1000;
          
          let maxIsd = 0;
          for (let i = 0; i < rows.length; i++) {
            const isd = Number(rows[i].ISD) || 0;
            if (isd > maxIsd) maxIsd = isd;
          }

          if (maxIsd > 0 && screenDiagonalKm > (maxIsd * ISD_MULTIPLIER)) {
            clearSectors();
            currentSites = [];
            return;
          }
        }

        for (var j = 0; j < rows.length; j++) {
          var r = rows[j];
          if (r.azRaw == null) {
            r.azimuths = [-1];
          }
          else if (typeof r.azRaw === 'number') {
            r.azimuths = [ r.azRaw ];
          } else {
            var raw = String(r.azRaw || '');
            var parts = raw.split(';');
            var azs = [];
            for (var k = 0; k < parts.length; k++) {
              var num = parseFloat(parts[k]);
              if (!isNaN(num)) {
                azs.push(num);
              }
            }
            r.azimuths = azs;
          }
        }

        // NEW: sort so rows with null azRaw go LAST
        rows.sort((a, b) => {
          const aNull = (a.azRaw == null);
          const bNull = (b.azRaw == null);
          if (aNull && !bNull) return 1;
          if (!aNull && bNull) return -1;
          return 0;
        });

        currentSites = rows;
        drawAllSectors();
      });
  }


  // 5) Bind updateVisibleSites to map events
  map.on('moveend', updateVisibleSites);
  map.on('zoomend', updateVisibleSites);

  // 6) When toggleAlwaysShow changes
  toggleAlwaysShow.addEventListener('change', function() {
    clearSectors();
    updateVisibleSites();
  });


    // ---------- NEW panel toggle behaviour (replace previous collapseBtn.onclick / toggleBtn.onclick) ----------
    const collapseBtn = document.getElementById('collapseBtn');
    const toggleBtn = document.getElementById('toggle-panel');
    

    function setPanelCollapsed(collapsed){
      if (collapsed) {
        controlPanel.classList.add('collapsed');
        toggleBtn.style.display = 'flex';
        toggleBtn.setAttribute('aria-expanded','false');
      } else {
        controlPanel.classList.remove('collapsed');
        toggleBtn.style.display = 'none';
        toggleBtn.setAttribute('aria-expanded','true');
      }
      requestSaveUI(); // persist change to indexedDB
    }

    // new — stop propagation so global document click handler won't undo the action
    collapseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setPanelCollapsed(true);
    });
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setPanelCollapsed(false);
    });
    

    // show FAB on small screens initially (non-saved)
    if (window.matchMedia('(max-width:640px)').matches) {
      // when mobile, keep panel visible but show FAB if collapsed state will be set later
      toggleBtn.style.display = controlPanel.classList.contains('collapsed') ? 'flex' : 'none';
    }

    //const sites=[{siteid:'SITE-1',sitename:'Central Jakarta Node',lat:-6.2,lng:106.816,azimuths:[60,180,300]}];
    const sectorHalfAngle=20; let range=100, currentTheme='4';
    let siteColors={}, sectorLayers={};
    let siteMarkers = [];
    let currentSites = [];
    let siteMarkersById = {}; // NEW: map siteId -> {outer, middle, circle, marker}

    let measureMode=false, refPoint=null, measureLine=null, measureMarker=null;


    // 1) Constants
    const DIST_KM = 3, BW_HALF = 100/2;

    // 2) Setup Dexie DB — dual-buffer (active / inactive)
    const DB_A_NAME = 'SiteDB_v2';
    const DB_B_NAME = 'SiteDB2_v2';

    // create both Dexie instances (same schema)
    const dbA = new Dexie(DB_A_NAME);
    // dbA.version(1).stores({ sites: 'siteId, sitename, lon, lat, azRaw' });
    dbA.version(2).stores({ sites: '[siteId+CELLTYPE], siteId, sitename, lon, lat' });
    
    const dbB = new Dexie(DB_B_NAME);
    // dbB.version(1).stores({ sites: 'siteId, sitename, lon, lat, azRaw' });
    dbB.version(2).stores({ sites: '[siteId+CELLTYPE], siteId, sitename, lon, lat' });
	
	// active DB selection persisted across reloads
	const storedActive = localStorage.getItem('activeSiteDB');
	let activeDbName = (storedActive === DB_A_NAME || storedActive === DB_B_NAME) ? storedActive : DB_B_NAME;

	// pick the Dexie instance by comparing names (safer than trusting object identity)
	let activeDb = (activeDbName === DB_A_NAME) ? dbA : dbB;
	let inactiveDb = (activeDb.name === dbA.name) ? dbB : dbA;

	// convenience reference used by the rest of the code
	let db = activeDb;

	// when a background load is running we will write into `targetDb` (the inactive one)
	let targetDb = null;


    // temporary in-memory store while background download is running
    const tempMemory = new Map(); // key = siteId, value = row object
    let usingTempMemory = true;   // true while download not finished



    function _openUIDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(_uiDBName, 1);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async function saveUISettings(obj) {
      try {
        const db = await _openUIDB();
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put(obj, _uiStoreKey);
        await new Promise(r => { tx.oncomplete = r; tx.onerror = () => r(); });
        db.close();
      } catch (e) { console.warn('saveUISettings failed', e); }
    }
    async function loadUISettings() {
      try {
        const db = await _openUIDB();
        const tx = db.transaction('settings', 'readonly');
        const req = tx.objectStore('settings').get(_uiStoreKey);
        const v = await new Promise(r => { req.onsuccess = () => r(req.result); req.onerror = () => r(null); });
        db.close();
        return v || null;
      } catch (e) { console.warn('loadUISettings fail', e); return null; }
    }
    function gatherUISettings() {
      const c = map.getCenter();
      return {
        center: { lat: c.lat, lng: c.lng },
        zoom: map.getZoom(),
        themeSelect: themeSelect.value,
        mapType: mapTypeSelect.value,
        range: +rangeSlider.value,
        zoomSlider: +zoomSlider.value,
        textSize: +textSizeSlider.value,
        toggleAlwaysShow: !!toggleAlwaysShow.checked,
        toggleSectors: !!toggleSectors.checked,
        toggleSiteId: !!toggleSiteId.checked,
        toggleSiteName: !!toggleSiteName.checked,
        // measureMode: !!measureToggle.checked,
        panelCollapsed: controlPanel.classList.contains('collapsed')  // new
      };
    }
    // new: prevent automatic save during initial restore
    let _suppressSaveUI = true;

    let _saveTimer = null;

    function requestSaveUI() {
      // when suppressed (during applySavedUI), do not schedule any save
      if (_suppressSaveUI) return;
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        _saveTimer = null;
        saveUISettings(gatherUISettings());
      }, 250);
    }

    /* wire controls to requestSaveUI */
    themeSelect.addEventListener('change', requestSaveUI);
    mapTypeSelect.addEventListener('change', requestSaveUI);
    rangeSlider.addEventListener('input', requestSaveUI);
    zoomSlider.addEventListener('input', requestSaveUI);
    textSizeSlider.addEventListener('input', () => { requestSaveUI(); drawAllSectors(); });
    toggleAlwaysShow.addEventListener('change', requestSaveUI);
    
    toggleSectors.addEventListener('change', () => {
      requestSaveUI();
      // if unchecked, clear both temp and permanent sector layers immediately
      if (!toggleSectors.checked) {
        try { tempSectorLayer.clearLayers(); } catch (e) {}
        try { sectorLayer.clearLayers(); } catch (e) {}
        return;
      }
      // if checked, redraw
      drawAllSectors();
    });

    toggleSiteId.addEventListener('change', () => { requestSaveUI(); drawAllSectors(); });
    toggleSiteName.addEventListener('change', () => { requestSaveUI(); drawAllSectors(); });
    // measureToggle.addEventListener('change', requestSaveUI);
    map.on('moveend', requestSaveUI);
    map.on('zoomend', requestSaveUI);

    async function applySavedUI() {

      try {
        const s = await loadUISettings();
        if (!s) return;
        try {
          if (s.themeSelect) { themeSelect.value = s.themeSelect; themeSelect.dispatchEvent(new Event('change')); }
          if (s.mapType) { mapTypeSelect.value = s.mapType; mapTypeSelect.dispatchEvent(new Event('change')); }
          if (typeof s.range !== 'undefined') { rangeSlider.value = s.range; range = +s.range; drawAllSectors(); }
          if (typeof s.textSize !== 'undefined') { textSizeSlider.value = s.textSize; currentTextSize = +s.textSize; drawAllSectors(); }
          if (typeof s.toggleAlwaysShow !== 'undefined') toggleAlwaysShow.checked = !!s.toggleAlwaysShow;
          if (typeof s.toggleSectors !== 'undefined') toggleSectors.checked = !!s.toggleSectors;
          if (typeof s.toggleSiteId !== 'undefined') toggleSiteId.checked = !!s.toggleSiteId;
          if (typeof s.toggleSiteName !== 'undefined') toggleSiteName.checked = !!s.toggleSiteName;
          // if (typeof s.measureMode !== 'undefined') measureToggle.checked = !!s.measureMode;
          if (s.center && typeof s.zoom !== 'undefined') {
            // use flyTo for smoother restore (tiles already added in initMapTilesAndCenter)
            map.setView([s.center.lat, s.center.lng], s.zoom);
            zoomSlider.value = s.zoom;
          } else if (typeof s.zoom !== 'undefined') {
            map.setZoom(s.zoom); zoomSlider.value = s.zoom;
          }

          // Force panel collapsed on load, ignoring saved state
          setPanelCollapsed(true);

        } catch (e) {
          console.warn('applySavedUI failed', e);
        }
      } finally {
        // finished restoring: re-enable saving for future user interactions.
        // IMPORTANT: do NOT call requestSaveUI() here — we must NOT auto-save during load.
        _suppressSaveUI = false;
      }
    }



    
    async function computeISD(k = 3, progressCb) {
      //console.log('computeISD: start');
      const rows = await db.sites.toArray();
      const N = rows.length;
      if (N === 0) {
        //console.log('computeISD: no rows');
        if (progressCb) progressCb(0,0);
        return;
      }

      // detect RBush implementation
      const RB = window.rbush || window.RBush || window.RBush || window.RBush || (typeof rbush !== 'undefined' && rbush) || null;
      let tree = null;
      if (RB) {
        try {
          tree = new RB();
          const items = rows.map(r => ({
            minX: Number(r.lon) || 0, minY: Number(r.lat) || 0,
            maxX: Number(r.lon) || 0, maxY: Number(r.lat) || 0,
            siteId: r.siteId
          }));
          tree.load(items);
        } catch (e) {
          console.warn('computeISD: rbush init failed, falling back to brute-force', e);
          tree = null;
        }
      } else {
        console.warn('computeISD: rbush not found, using O(N^2) fallback');
      }

      const out = [];
      for (let i = 0; i < N; i++) {
        const a = rows[i];
        // defensive normalisation
        a.lon = Number(a.lon);
        a.lat = Number(a.lat);
        if (!isFinite(a.lon) || !isFinite(a.lat)) {
          a.ISD = 0;
          out.push(a);
          if (progressCb && i % 50 === 0) progressCb(i+1, N);
          continue;
        }

        const dists = [];
        if (tree) {
          // expand search box until we have enough neighbours
          let half = 0.01; // ~1km at equator ~ not exact but for initial probe
          while (half < 180) {
            const found = tree.search({
              minX: a.lon - half, minY: a.lat - half,
              maxX: a.lon + half, maxY: a.lat + half
            }).filter(f => String(f.siteId) !== String(a.siteId));

            if (found.length >= k || half > 90) {
              for (const f of found) {
                // turf.distance expects [lng,lat]
                try {
                  const km = turf.distance([a.lon, a.lat], [f.minX, f.minY], { units: 'kilometers' });
                  if (!isNaN(km)) dists.push(km);
                } catch (e) { /* ignore single error */ }
              }
              break;
            }
            half *= 2;
          }
        } else {
          // brute-force
          for (let j = 0; j < N; j++) {
            if (i === j) continue;
            const b = rows[j];
            const blon = Number(b.lon), blat = Number(b.lat);
            if (!isFinite(blon) || !isFinite(blat)) continue;
            try {
              const km = turf.distance([a.lon, a.lat], [blon, blat], { units: 'kilometers' });
              if (!isNaN(km)) dists.push(km);
            } catch (e) {}
          }
        }

        dists.sort((x,y) => x-y);
        const pick = dists.slice(0, k);
        a.ISD = pick.length ? (pick.reduce((s,v)=>s+v,0) / pick.length) : 0;
        out.push(a);

        if (progressCb && (i % 100 === 0 || i === N-1)) progressCb(i+1, N);
        // yield occasionally so UI doesn't lock
        if (i % 200 === 0) await new Promise(r=>setTimeout(r,0));
      }

      // persist
      try {
        await db.sites.bulkPut(out);
        //console.log('computeISD: bulkPut done for', out.length);
      } catch (e) {
        //console.warn('computeISD: bulkPut failed, falling back to per-row put', e);
        for (const r of out) {
          try { await db.sites.put(r); } catch(_) {}
        }
        //console.log('computeISD: per-row put done');
      }
      if (progressCb) progressCb(N, N);
      console.log('computeISD: finished');
    }








    // Build GeoJSON “vectors” based on ISD
    async function loadVectors() {
      const raw = await db.sites.toArray();
      return raw.flatMap(r => {
        try {
          
          // use ISD (km) if present; otherwise fallback to 3 km
          const D = (Number(r.ISD) && isFinite(Number(r.ISD)) ? Number(r.ISD) : 3) * 2;

          return String(r.azRaw ?? '').split(';')
            .map(a=>parseFloat(a))
            .filter(azi=>!isNaN(azi))
            .map(azi => turf.polygon([[
              [r.lon, r.lat],
              turf.destination([r.lon, r.lat], D, azi - BW_HALF, { units:'kilometers' }).geometry.coordinates,
              turf.destination([r.lon, r.lat], D, azi + BW_HALF, { units:'kilometers' }).geometry.coordinates,
              [r.lon, r.lat]
            ]], { siteId: r.siteId }));
        } catch (e) {
          console.error('Error building vectors for', r.siteId, r);
          throw e;   // re-throw so you still see the turf error stack
        }
      });
    }


    // 6) Pure‑client getNeighbors
    function getNeighborsClient(targetSiteId) {
      const tree = geojsonRbush();
      tree.load({ type: 'FeatureCollection', features: vectors });
      const result = new Set();
      vectors
        .filter(f=>f.properties.siteId===targetSiteId)
        .forEach(tgt=>{
          (tree.search(tgt).features||[])
            .filter(f=>f.properties.siteId!==targetSiteId)
            .forEach(f=>{
              if (turf.booleanIntersects(tgt, f)) {
                result.add(f.properties.siteId);
              }
            });
        });
      return [...result];
    }

    // 7) Wire it up 
    let vectors = [];

    /* ============================
       Client incremental loader
       Replace previous JSONP + eager load functions
       ============================ */





    // add these helpers

    function updatePerfBadge(status, downloaded, total) {
      const pct = (total && total > 0) ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
      const parts = [];
      parts.push(status);
      // parts.push(downloaded + ' rows');
      // if (total !== null) parts.push('of ' + total);
      if (pct !== null) parts.push('(' + pct + '%)');
      if (status != 'finished') {
          badge.textContent = parts.join(' · ');
      }
      
      // color mapping
      if (status === 'finished') {
        badge.textContent = '';
        badge.style.background = 'rgba(0,128,0,0.7)';
      }
      else if (status === 'paused') badge.style.background = 'rgba(255,165,0,0.7)';
      else if (status === 'loading') badge.style.background = 'rgba(0,122,255,0.8)';
      else badge.style.background = 'rgba(0,0,0,0.5)';
    }




    /**
     * DataUpdate(rows)
     * - rows: Array of server rows (each row has SITE_ID, SITE_NAME, X_LONGITUDE, Y_LATITUDE, AZ, AH, MRBTS, BEAM, MT, ET, CELLTYPE, PCI, CARRIER, etc.)
     * Behavior (per request):
     *  - write all rows into the inactive DB (mapped fields)
     *  - update progress badge as rows are inserted
     *  - swap active DB -> inactive DB after complete
     *  - rebuild vectors, draw visible sites, compute ISD, mark finished
     */
    async function DataUpdate(rawRows) {
      if (!Array.isArray(rawRows)) {
        console.error('DataUpdate: rows must be an array');
        return;
      }

      // --- START CLIENT-SIDE AGGREGATION ---
      const grouped = new Map();

      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i];
        // handle Supabase lowercase JSON output
        const sid = r.site_id || r.SITE_ID;
        const ctype = r.celltype || r.CELLTYPE;
        if (!sid) continue;

        const key = sid + '_' + ctype;
        if (!grouped.has(key)) {
          grouped.set(key, {
            SITE_ID: sid,
            CELLTYPE: ctype,
            SITE_NAME: r.site_name || r.SITE_NAME || null,
            X_LONGITUDE: r.x_longitude || r.X_LONGITUDE || null,
            Y_LATITUDE: r.y_latitude || r.Y_LATITUDE || null,
            AH: r.height_antenna_m || r.AH || null,
            sectors: new Map(),
            mrbts_set: new Set(),
            is5GActive: false
          });
        }
        const g = grouped.get(key);
        
        const sector = r.sector || r.SECTOR;
        const az = r.antenna_azimuth_deg || r.ANTENNA_AZIMUTH_DEG;
        const mt = r.antenna_mechanical_tilt_deg || r.ANTENNA_MECHANICAL_TILT_DEG;
        const et = r.antenna_electrical_tilt_deg || r.ANTENNA_ELECTRICAL_TILT_DEG;
        const pci = r.pci || r.PCI;
        const mrbts = r.bts_id_or_node_b_id_or_enode_b_id || r.BTS_ID_OR_NODE_B_ID_OR_ENODE_B_ID;
        const sysInfo = r.cell_system_info || r.CELL_SYSTEM_INFO;
        const status = r.bts_status || r.BTS_STATUS;
        const beam = r.beam || r.BEAM;

        if (mrbts != null) g.mrbts_set.add(mrbts);
        if (sysInfo === '5G_2100' && status === 'ACTIVE') g.is5GActive = true;

        if (ctype === 'MACRO' && sector != null) {
          if (!g.sectors.has(sector)) {
            g.sectors.set(sector, { az: new Set(), mt: new Set(), et: new Set(), pci: new Set(), beams: new Set() });
          }
          const s = g.sectors.get(sector);
          if (az != null) s.az.add(az);
          if (mt != null) s.mt.add(mt);
          if (et != null) s.et.add(et);
          if (pci != null) s.pci.add(pci);
          if (beam != null) s.beams.add(beam);
        }
      }

      const rows = [];
      for (const g of grouped.values()) {
        const out = {
          SITE_ID: g.SITE_ID,
          SITE_NAME: g.SITE_NAME,
          X_LONGITUDE: g.X_LONGITUDE,
          Y_LATITUDE: g.Y_LATITUDE,
          AH: g.AH,
          CELLTYPE: g.CELLTYPE,
          MRBTS: g.mrbts_set.size > 0 ? Array.from(g.mrbts_set).sort().join(';') : null,
          BTS_STATUS_5G: g.is5GActive ? 'ACTIVE' : null,
          AZ: null, MT: null, ET: null, PCI: null, BEAM: null
        };

        if (g.CELLTYPE === 'MACRO' && g.sectors.size > 0) {
          const sortedSectors = Array.from(g.sectors.keys()).sort((a, b) => a - b);
          out.AZ = sortedSectors.map(sec => Array.from(g.sectors.get(sec).az).join(';')).join(';');
          out.MT = sortedSectors.map(sec => Array.from(g.sectors.get(sec).mt).join(';')).join(';');
          out.ET = sortedSectors.map(sec => Array.from(g.sectors.get(sec).et).join(';')).join(';');
          out.PCI = sortedSectors.map(sec => Array.from(g.sectors.get(sec).pci).join(';')).join(';');
          out.BEAM = sortedSectors.map(sec => g.sectors.get(sec).beams.size).join(';');
        }
        rows.push(out);
      }
      // --- END CLIENT-SIDE AGGREGATION ---

      try {
        // Use inactiveDb as the target (double-buffer pattern)
        targetDb = inactiveDb;

        // try {
        //   // clear target DB before writing
        //   await targetDb.sites.clear();
        //   console.log('DataUpdate: cleared target DB');
        // } catch (e) {
        //   console.warn('DataUpdate: could not clear target DB, continuing', e);
        //   // continue anyway
        // }

        // Delete the entire target DB, since schema changed (version 2)
        try {
          await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(targetDb.name);
            req.onsuccess = () => { console.log("DataUpdate: deleted old DB", targetDb.name); resolve(); };
            req.onerror = () => { console.warn("DataUpdate: failed to delete old DB", targetDb.name); resolve(); };
            req.onblocked = () => { console.warn("DataUpdate: delete blocked", targetDb.name); resolve(); };
          });
        } catch (e) {
          console.error("DataUpdate: Unexpected error deleting DB", e);
        }

        // Recreate the target DB using the updated schema
        targetDb = new Dexie(targetDb.name);
        targetDb.version(2).stores({
          sites: '[siteId+CELLTYPE], siteId, sitename, lon, lat'
        });
        await targetDb.open();
        console.log("DataUpdate: recreated DB with new schema:", targetDb.name);


        const total = rows.length;
        let inserted = 0;
        updatePerfBadge('loading', inserted, total);

        // no aggregation by siteid
        const CHUNK = 500; // adjust if you want larger/smaller batches

        for (let i = 0; i < total; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK).map(r => {
            // defensive reads — some fields may be missing or null
            const mapped = {
              MT: r.MT ?? null,
              azRaw: r.AZ ?? null,              // original AZ string (e.g. "90;230;350")
              beams: r.BEAM ?? null,
              carriers: (typeof r.CARRIER === 'undefined') ? null : r.CARRIER,
              cellid: null,                     // as requested: null
              enbid: r.MRBTS ?? null,
              height: (typeof r.AH !== 'undefined' && r.AH !== null) ? r.AH : null,
              lat: (typeof r.Y_LATITUDE !== 'undefined') ? Number(r.Y_LATITUDE) : null,
              lon: (typeof r.X_LONGITUDE !== 'undefined') ? Number(r.X_LONGITUDE) : null,
              siteId: r.SITE_ID ?? null,
              sitename: r.SITE_NAME ?? null,
              // new additional columns
              ET: r.ET ?? null,
              CELLTYPE: r.CELLTYPE ?? null,
              PCI: r.PCI ?? null,
              '5G': r.BTS_STATUS_5G ?? null
            };
            return mapped;
          });

          // write chunk
          try {
            // use bulkPut for speed; Dexie will upsert by primary key (siteId)
            await targetDb.sites.bulkPut(chunk);
          } catch (e) {
            // On failure, fall back to individual puts (slower but resilient)
            console.warn('DataUpdate: bulkPut failed, falling back to single put for chunk', e);
            for (const item of chunk) {
              try { await targetDb.sites.put(item); }
              catch (ee) { console.error('DataUpdate: single put failed', ee, item); }
            }
          }

          inserted += chunk.length;
          updatePerfBadge('loading', inserted, total);

          // yield to UI event loop briefly
          await new Promise(r => setTimeout(r, 0));
        }


        // // --- aggregate rows by siteId ---
        // const aggregated = new Map(); // key = siteId, value = merged site object
        // for (let r of rows) {
        //   const sid = String(r.SITE_ID ?? '').trim();
        //   if (!sid) continue;

        //   // normalize fields we want to merge
        //   const az = (r.AZ && String(r.AZ).trim()) ? String(r.AZ).trim() : null;
        //   const beams = (r.BEAM && String(r.BEAM).trim()) ? String(r.BEAM).trim() : null;
        //   const pci = (r.PCI && String(r.PCI).trim()) ? String(r.PCI).trim() : null;
        //   const et = (r.ET && String(r.ET).trim()) ? String(r.ET).trim() : null;
        //   const celltype = r.CELLTYPE ?? null;
        //   const mt = r.MT ?? null;
        //   const carriers = (typeof r.CARRIER === 'undefined') ? null : r.CARRIER;
        //   const enbid = r.MRBTS ?? null;
        //   const height = (typeof r.AH !== 'undefined' && r.AH !== null) ? r.AH : null;
        //   const lat = (typeof r.Y_LATITUDE !== 'undefined') ? Number(r.Y_LATITUDE) : null;
        //   const lon = (typeof r.X_LONGITUDE !== 'undefined') ? Number(r.X_LONGITUDE) : null;
        //   const sitename = r.SITE_NAME ?? null;
        //   const b5g = r.BTS_STATUS_5G ?? null; // or r['5G'] if your field is '5G'

        //   if (!aggregated.has(sid)) {
        //     aggregated.set(sid, {
        //       siteId: sid,
        //       sitename: sitename,
        //       lon: lon,
        //       lat: lat,
        //       azRaw: az || null,
        //       beams: beams || null,
        //       PCI: pci || null,
        //       ET: et || null,
        //       CELLTYPE: celltype,
        //       MT: mt,
        //       carriers: carriers,
        //       enbid: enbid,
        //       height: height,
        //       '5G': b5g
        //     });
        //   } else {
        //     // merge into existing entry (avoid duplicates)
        //     const cur = aggregated.get(sid);

        //     // merge azRaw semicolon lists
        //     if (az) {
        //       const existingAzParts = (String(cur.azRaw || '') || '').split(';').filter(Boolean);
        //       const newAzParts = String(az).split(';').filter(Boolean);
        //       const mergedAz = Array.from(new Set(existingAzParts.concat(newAzParts))).join(';');
        //       cur.azRaw = mergedAz || null;
        //     }

        //     // merge beams similarly (keep order aligned with az if desired)
        //     if (beams) {
        //       const existingB = (String(cur.beams || '') || '').split(';').filter(Boolean);
        //       const newB = String(beams).split(';').filter(Boolean);
        //       cur.beams = Array.from(new Set(existingB.concat(newB))).join(';') || cur.beams;
        //     }

        //     // merge PCI
        //     if (pci) {
        //       const existingP = (String(cur.PCI || '') || '').split(';').filter(Boolean);
        //       const newP = String(pci).split(';').filter(Boolean);
        //       cur.PCI = Array.from(new Set(existingP.concat(newP))).join(';') || cur.PCI;
        //     }

        //     // prefer non-null fields for single-valued fields
        //     if (!cur.sitename && sitename) cur.sitename = sitename;
        //     if (!cur.lat && lat) cur.lat = lat;
        //     if (!cur.lon && lon) cur.lon = lon;
        //     if (!cur.height && height) cur.height = height;
        //     if (!cur['5G'] && b5g) cur['5G'] = b5g;
        //     // optionally merge CELLTYPE values into semicolon list
        //     if (celltype && cur.CELLTYPE !== celltype) {
        //       cur.CELLTYPE = (cur.CELLTYPE ? String(cur.CELLTYPE) + ';' : '') + celltype;
        //     }
        //     // update enbid if missing
        //     if (!cur.enbid && enbid) cur.enbid = enbid;

        //     aggregated.set(sid, cur);
        //   }
        // }

        // // Now create an array of unique site objects for DB insertion
        // const uniqueSites = Array.from(aggregated.values());

        // // Then proceed to write uniqueSites in chunks instead of rows
        // const CHUNK = 500;
        // for (let i = 0; i < uniqueSites.length; i += CHUNK) {
        //   const chunk = uniqueSites.slice(i, i + CHUNK);
        //   try {
        //     await targetDb.sites.bulkPut(chunk);
        //   } catch (e) {
        //     console.warn('DataUpdate: bulkPut failed, falling back to single put for chunk', e);
        //     for (const item of chunk) {
        //       try { await targetDb.sites.put(item); }
        //       catch (ee) { console.error('DataUpdate: single put failed', ee, item); }
        //     }
        //   }
        //   inserted += chunk.length;
        //   updatePerfBadge('loading', inserted, uniqueSites.length);
        //   await new Promise(r => setTimeout(r, 0));
        // }




        // After all inserts: finalization & atomic swap
		// Swap active DB to targetDb
		if (targetDb) {
		  // new Dexie instance (targetDb) becomes logical active DB
		  activeDb = targetDb;
		  db = activeDb;

		  // compute inactive DB by name (robust when instances were recreated)
		  inactiveDb = (activeDb.name === DB_A_NAME) ? dbB : dbA;

		  // persist active DB name using name comparison (avoid object identity)
		  const activeName = (activeDb.name === DB_A_NAME) ? DB_A_NAME : DB_B_NAME;
		  localStorage.setItem('activeSiteDB', activeName);
		  console.log('DataUpdate: swapped active DB to', activeName);

		  // not using tempMemory streaming in this flow
		  usingTempMemory = false;
		}

        // Rebuild vectors from the freshly-written active DB
        try {
          vectors = await loadVectors();
        } catch (e) {
          console.error('DataUpdate: loadVectors failed', e);
          vectors = [];
        }

        // Draw visible sites
        try {
          updateVisibleSites();
        } catch (e) {
          console.error('DataUpdate: updateVisibleSites failed', e);
        }

        // Compute ISD on the new active DB (so ISD is accurate for fresh data)
        try {
          const need = await db.sites.filter(r => typeof r.ISD !== 'number' || isNaN(r.ISD)).count();
          if (need > 0) {
            // show ISD progress on badge
            await computeISD(3, (done, tot) => updatePerfBadge('ISD ' + done + '/' + tot, done, tot));
          }
        } catch (e) {
          console.error('DataUpdate: computeISD failed', e);
        }

        // final mark finished
        updatePerfBadge('finished', inserted, total);

      } catch (e) {
        console.error('DataUpdate: unexpected error', e);
        updatePerfBadge('paused', 0, rows.length || null);
      } finally {
        // hide loading label (you said not necessary to re-enable sliders)
        try { loadingLabel.style.display = 'none'; } catch (_) {}
        // clear bgNextStart (defensive)
        try { localStorage.removeItem('bgNextStart'); } catch (_) {}
      }
    }
    

    document.addEventListener('DOMContentLoaded', async () => {
      await applySavedUI();        // <--- NEW: restore UI state before data load
      
      // args from the page URL
      try {
        applyURLArgsFromLocation();
      } catch (e) {
        console.warn('Auto-apply URL args failed', e);
      }

      });






    function clearSectors() {
      // 1) Remove every polygon from the map      
      // console.log('Clearing sectors from:', Object.keys(sectorLayers));
      Object.values(sectorLayers).forEach(layerArray => {
        layerArray.forEach(layer => map.removeLayer(layer));
      });
      
      // 2) Reset your container
      sectorLayers = {};
    
      siteMarkers.forEach(marker => map.removeLayer(marker));
      siteMarkers = [];

      // NEW: also clear the id-index so future draws can be created again
      siteMarkersById = {};      

      if (typeof tempSectorLayer !== 'undefined') tempSectorLayer.clearLayers();
      if (typeof sectorLayer !== 'undefined') sectorLayer.clearLayers();


    }

    // ES5‐compatible drawSingleSite
    function drawSingleSite(site) {

      if (siteMarkersById[site.siteId]) return;

      // build label parts
      var parts = [];
      if (toggleSiteId.checked) {
        parts.push('<b>' + site.siteId + '</b>');
      }
      if (toggleSiteName.checked) {
        parts.push('<br>'+ site.sitename);
      }

      var outer = L.circleMarker([site.lat, site.lon], {
        radius: 5,
        color: 'white',
        weight: 3,
        fillOpacity: 0,
        interactive: false
      }).addTo(map);

      var middle = L.circleMarker([site.lat, site.lon], {
        radius: 4,
        color: 'black',
        weight: 2,
        fillOpacity: 0,
        interactive: false
      }).addTo(map);

      var isActive5G = (site['5G'] === 'ACTIVE');
      var dotColor = isActive5G ? 'red' : 'hsl(219,100%,50%)';

      var circle = L.circleMarker([site.lat, site.lon], {
        radius: 2,
        color: dotColor,
        fillColor: dotColor,
        fillOpacity: 1,
        weight: 1,
        interactive: false
      }).addTo(map);

      // build HTML for label using string concatenation
      var labelHtml = '<span style="font-size:' +
                      currentTextSize +
                      'px;">' +
                      parts.join(' ') +
                      '</span>';

      // draw div icon marker
      var marker = L.marker([site.lat, site.lon], {
        icon: L.divIcon({
          className: 'bts-label',
          html: labelHtml,
          iconAnchor: [0, 0]
        })
      }).addTo(map);

      // store for later removal
      // siteMarkers.push(circle);
      // siteMarkers.push(marker);

      // --- STORE ALL LAYERS (NEW) ---
      siteMarkers.push(outer, middle, circle, marker);
      siteMarkersById[site.siteId] = {
        outer: outer,
        middle: middle,
        circle: circle,
        marker: marker
      };
            
    }


  function drawSingleSectors(site, beamOptions = {}) {
    if (!site) { console.debug('drawSingleSectors: no site'); return; }
    if (!site.azimuths || !Array.isArray(site.azimuths)) {
      console.debug('drawSingleSectors: site.azimuths missing or not array', site);
      return;
    }

    //console.groupCollapsed(`drawSingleSectors: site ${site.siteId}`);
    const layers = [];
    const beamCounts = parseBeamCounts(site.beams, site.azimuths.length);

    const defaultBeamOpts = { color: null, weight: 3, lengthMultiplier: 1.4 };
    const opts = Object.assign({}, defaultBeamOpts, beamOptions);

    site.azimuths.forEach((azRaw, idx) => {
      // coerce az to number (fixes "120" string issues)
      const theme4 = (currentTheme === '4');
      let az = Number(azRaw);      
      if (az==360) az=0;
      let celltype = site.CELLTYPE;
       
      const color = getColor(site, idx);
      //console.groupCollapsed(` sector idx=${idx} rawAz=${azRaw} coercedAz=${az} color=${color}`);
      if (!color) { console.debug('  no color, skipping sector'); console.groupEnd(); return; }
      if (!isFinite(az)) { console.debug('  az is not numeric -> skipping', azRaw); console.groupEnd(); return; }

      const beamsForSector = Number(beamCounts[idx] || 0);
      //console.debug('  beamsForSector:', beamsForSector);
      if (!theme4) {
        // draw beam arrows first so sectors are above them
        if (beamsForSector > 1) {
          if (celltype==='IBS') {
            // full-circle: irrelevant
  
          } else {
            const beamAngles = generateBeamAngles(az, beamsForSector, sectorHalfAngle);
            //console.debug('   beamAngles:', beamAngles);
            beamAngles.forEach((beamAz, bi) => {
              //console.debug(`   draw beam ${bi} az=${beamAz}`);
              const arrowLayer = drawBeamArrow(site, beamAz, range * opts.lengthMultiplier, { color, weight: opts.weight });            
              if (arrowLayer) {              
                sectorLayer.addLayer(arrowLayer);
                layers.push(arrowLayer);
              }            
            });
          }
        } else {
          //console.debug('   no beams for this sector');
        }
      }

      const outerOutlineColor = '#fff';
      const innerOutlineColor = '#000';
      const outerWeight = (opts && opts.weight ? opts.weight : 3) + 4;
      const innerWeight = (opts && opts.weight ? opts.weight : 3) + 2;

      if (celltype==='IBS') {
        // full circle: outer white, inner black, then filled circle
        const circOuter = L.circle([site.lat, site.lon], {
          radius: range/2,
          color: outerOutlineColor,
          fillOpacity: 0,
          weight: 3,
          opacity: 1
        });
        sectorLayer.addLayer(circOuter);

        const circInner = L.circle([site.lat, site.lon], {
          radius: range/2,
          color: innerOutlineColor,
          fillOpacity: 0,
          weight: 2,
          opacity: 0
        });
        sectorLayer.addLayer(circInner)

        const circFill = L.circle([site.lat, site.lon], {
          radius: range/2,
          color: color,
          fillColor: color,
          fillOpacity: 0,
          weight: 0
        });
        sectorLayer.addLayer(circFill);

        layers.push(circOuter, circInner, circFill);
        //console.debug('   drew full circle with double outline', circFill);
      } else {
        // ensure left/right are defined in this scope
        const left  = getAzimuthEnd(site.lat, site.lon, az - sectorHalfAngle, range);
        const right = getAzimuthEnd(site.lat, site.lon, az + sectorHalfAngle, range);
        
        
        
        // outer white outline
        const polyOuter = L.polygon([[site.lat, site.lon], left, right], {
          color: outerOutlineColor,
          fillOpacity: 0,
          weight: outerWeight,
          opacity: theme4? 0 : 1
        });
        sectorLayer.addLayer(polyOuter);

        // inner black outline
        const polyInner = L.polygon([[site.lat, site.lon], left, right], {
          color: innerOutlineColor,
          fillOpacity: 0,
          weight: innerWeight,
          opacity: theme4? 0 : 1
        });
        sectorLayer.addLayer(polyInner);

        // filled sector on top (no stroke)
        const polyFill = L.polygon([[site.lat, site.lon], left, right], {
          color: color,
          fillColor: color,
          fillOpacity: theme4? 0.5 : 1,
          weight: 0
        });
        sectorLayer.addLayer(polyFill);

        layers.push(polyOuter, polyInner, polyFill);
        //console.debug('   drew polygon with double outline', polyFill);
      }


      //console.groupEnd(); // sector
    });

    if (layers.length) {
      sectorLayers[site.siteId] = layers;
      //console.debug(' total layers saved for site:', layers.length);
    } else {
      //console.debug(' no layers for site');
    }
    //console.groupEnd(); // site
  }

  /* unchanged but safer parse & helpers with debug */

  /**
   * Robust parser: accepts
   *  - semicolon string "2;1;3"
   *  - array of numbers [2,1,3]
   *  - array of objects [{count:2},{beams:1},{value:3}]
   * Pads/trims to expectedLength, missing => 0
   */
  function parseBeamCounts(siteBeams, expectedLength) {
    const result = new Array(expectedLength).fill(0);

    // string case: "2;1;3"
    if (siteBeams && typeof siteBeams === 'string') {
      const parts = siteBeams.split(';').map(s => {
        const n = parseInt(s, 10);
        return isNaN(n) ? 0 : n;
      });
      for (let i = 0; i < expectedLength; i++) result[i] = parts[i] || 0;
      console.debug('parseBeamCounts (string) ->', result);
      return result;
    }

    // array case
    if (Array.isArray(siteBeams)) {
      for (let i = 0; i < expectedLength; i++) {
        const v = siteBeams[i];
        if (v === undefined || v === null) { result[i] = 0; continue; }

        // number directly
        if (typeof v === 'number' && isFinite(v)) { result[i] = Math.max(0, Math.floor(v)); continue; }

        // string inside array
        if (typeof v === 'string') {
          const n = parseInt(v, 10);
          result[i] = isNaN(n) ? 0 : n;
          continue;
        }

        // object: try common numeric property names
        if (typeof v === 'object') {
          const keysToTry = ['count','beams','value','cnt','num','n'];
          let found = false;
          for (let k of keysToTry) {
            if (Object.prototype.hasOwnProperty.call(v, k)) {
              const n = parseInt(v[k], 10);
              if (!isNaN(n)) { result[i] = Math.max(0, Math.floor(n)); found = true; break; }
            }
          }
          // if not found but object is a plain number-like (rare), try coercion
          if (!found) {
            const coerced = Number(v);
            result[i] = (isFinite(coerced) && coerced !== 0) ? Math.max(0, Math.floor(coerced)) : 0;
          }
          continue;
        }

        // fallback
        result[i] = 0;
      }

      //console.debug('parseBeamCounts (array) ->', result);
      return result;
    }

    // fallback: not provided or unexpected type
    //console.debug('parseBeamCounts: invalid input -> default zeros', siteBeams);
    return result;
  }


  function generateBeamAngles(az, count, halfAngle) {
    az = Number(az);
    if (!count || count <= 0) return [];
    if (count === 1) return [normalizeAz(az)];

    const centerOffset = (count - 1) / 2;
    const step = halfAngle / centerOffset;
    const angles = [];
    for (let i = 0; i < count; i++) {
      const offsetMultiplier = i - centerOffset;
      const beamAz = az + offsetMultiplier * step;
      angles.push(normalizeAz(beamAz));
    }
    return angles;
  }

  function normalizeAz(a) {
    let x = Number(a) % 360;
    if (isNaN(x)) return 0;
    if (x < 0) x += 360;
    return x;
  }

  function drawBeamArrow(site, angle, lengthMeters, opts = {}) {
    if (!site || typeof angle !== 'number') { console.debug('drawBeamArrow: invalid input', site, angle); return null; }

    // visual params (unchanged)
    const weight = (typeof opts.weight === 'number') ? opts.weight : 3; // visible stroke for arrow body
    const outerOutlineColor = '#ffffff'; // outer outline (white)
    const innerOutlineColor = '#000000'; // inner outline (black)
    const arrowColor = '#ffffff';        // arrow fill/body (white)

    // tip sizing in meters (same base logic as before)
    const tipLenMeters = Math.max(5, lengthMeters * 0.06);
    const tipBaseHalfWidthMeters = Math.max(2, tipLenMeters * 0.5);

    // shaft length in meters (same as before)
    const shaftLen = Math.max(1, lengthMeters - tipLenMeters);

    // compute shaft end using meters (unchanged)
    const shaftEnd = getAzimuthEnd(site.lat, site.lon, angle, shaftLen);

    // validate shaftEnd
    if (!isFinite(shaftEnd[0]) || !isFinite(shaftEnd[1])) {
      console.debug('drawBeamArrow: invalid shaftEnd', shaftEnd);
      return null;
    }

    // --- SHAFT: outer white, middle black, body white (unchanged) ---
    const outerWeight = Math.max(1, weight + 6);
    const middleWeight = Math.max(1, weight + 3);
    const bodyWeight = Math.max(1, weight);

    // create polylines (do NOT add them directly to map here)
    const outerShaft = L.polyline([[site.lat, site.lon], shaftEnd], {
      color: outerOutlineColor, weight: outerWeight, opacity: 1
    });
    const middleShaft = L.polyline([[site.lat, site.lon], shaftEnd], {
      color: innerOutlineColor, weight: middleWeight, opacity: 1
    });
    const bodyShaft = L.polyline([[site.lat, site.lon], shaftEnd], {
      color: arrowColor, weight: bodyWeight, opacity: 1
    });

    // group them, add the group to the map and return the group so callers can manage it
    const arrowGroup = L.layerGroup([outerShaft, middleShaft, bodyShaft]);
    return arrowGroup;

  }




    // ▶ clear + (re)draw every site in currentSites
	function drawAllSectorsTimed() {
	  clearSectors();
	  
    currentSites.forEach(site => {
		if (toggleSectors.checked) {
		  drawSingleSectors(site);
		}
		drawSingleSite(site);
	  });
	}

	function drawAllSectors() {
	  const t0 = performance.now();
    if (!toggleAlwaysShow.checked) { clearSectors(); return; }
	  drawAllSectorsTimed();
	  const dt = Math.round(performance.now() - t0);

	  // badge.textContent = dt + ' ms';
	  // // color logic:
	  // if (dt < 150)       badge.style.background = 'rgba(0,128,0,0.7)';   // green
	  // else if (dt < 500) badge.style.background = 'rgba(255,165,0,0.7)'; // yellow/orange
	  // else                badge.style.background = 'rgba(255,0,0,0.7)';   // red
	}



  // 1) getAzimuthEnd
  function getAzimuthEnd(lat, lng, az, len) {
    var R = 6378137;
    var rad = Math.PI / 180;
    var brng = az * rad;
    var lat1 = lat * rad;
    var lon1 = lng * rad;
    var lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(len / R) +
      Math.cos(lat1) * Math.sin(len / R) * Math.cos(brng)
    );
    var lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(len / R) * Math.cos(lat1),
      Math.cos(len / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [lat2 / rad, lon2 / rad];
  }

  // 2) getColor
  function getColor(site, idx) {
    var theme = currentTheme;
    if (theme === '1' || theme === '4') {
      // expanded to 4 distinct colors so up to 4 sectors show different colors
      return ['#990000', '#003366', '#006600', '#CC9900'][idx % 4];
    }
    if (theme === '2') {
      if (!siteColors[site.siteId]) {
        siteColors[site.siteId] = '#' +
          Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, '0');
      }
      return siteColors[site.siteId];
    }
    if (theme === '3') {
      return 'green';
    }
    // theme '4'
    return null;
  }

  // store finished measurements so they can be cleared
  var finishedMeasureMarkers = [];
  var finishedMeasureLines   = [];

// bearing helper (ES5)
  function getBearing(lat1, lon1, lat2, lon2) {
    var toRad = Math.PI / 180;
    var toDeg = 180 / Math.PI;
    var phi1 = lat1 * toRad;
    var phi2 = lat2 * toRad;
    var deltaLambda = (lon2 - lon1) * toRad;
    var y = Math.sin(deltaLambda) * Math.cos(phi2);
    var x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    var theta = Math.atan2(y, x);
    var brng = (theta * toDeg + 360) % 360;
    return brng;
  }

  // clear only the "current" measuring (not finished ones)
  function clearCurrentMeasurement() {
    if (measureLine) {
      map.removeLayer(measureLine);
      measureLine = null;
    }
    if (measureMarker) {
      map.removeLayer(measureMarker);
      measureMarker = null;
    }
    refPoint = null;
  }

  // clear ALL measurements (finished + current)
  function clearAllMeasurements() {
    // remove finished
    for (var i = 0; i < finishedMeasureLines.length; i++) {
      map.removeLayer(finishedMeasureLines[i]);
    }
    for (var j = 0; j < finishedMeasureMarkers.length; j++) {
      map.removeLayer(finishedMeasureMarkers[j]);
    }
    finishedMeasureLines = [];
    finishedMeasureMarkers = [];

    // remove current
    clearCurrentMeasurement();
  }

  // start / finish measurement on click
  // function startMeasure(e) {
  //   // if no start point -> start new measurement
  //   if (!refPoint) {
  //     refPoint = e.latlng;
  //     measureMarker = L.marker(refPoint).addTo(map);
  //     // ensure mousemove live updates are active (they will be if toggle enabled)
  //     // measureLine will be created/updated in updateMeasure
  //   } else {
  //     // finish measurement to clicked point
  //     var end = e.latlng;

  //     // remove any transient line (we will create a final one)
  //     if (measureLine) {
  //       map.removeLayer(measureLine);
  //       measureLine = null;
  //     }

  //     // create final polyline and final marker
  //     var finalLine = L.polyline([refPoint, end]).addTo(map);
  //     var d = refPoint.distanceTo(end);
  //     var az = getBearing(refPoint.lat, refPoint.lng, end.lat, end.lng);
  //     finalLine.bindTooltip(d.toFixed(1) + ' m · ' + az.toFixed(1) + '°', { permanent: true, offset: [0, -10] }).openTooltip();

  //     var endMarker = L.marker(end).addTo(map);

  //     // store finished measurement for later clearing
  //     finishedMeasureLines.push(finalLine);
  //     finishedMeasureMarkers.push(endMarker);

  //     // remove the start marker (optional) or keep it: here we'll remove it
  //     if (measureMarker) {
  //       map.removeLayer(measureMarker);
  //       measureMarker = null;
  //     }

  //     // reset for next measurement
  //     refPoint = null;
  //     measureLine = null;
  //   }
  // }



  // pixel-based arrow. sizePx = tip-to-base box in pixels. color follows line.
  function makeArrow(latlng, angleDeg, sizePx, color) {
    sizePx = sizePx || 18;           // slightly bigger by default
    color = color || '#000';
    const half = sizePx / 2;
    // triangle points: tip centered at top, base along bottom
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}" aria-hidden="true">
        <polygon points="${half},0 ${sizePx},${sizePx} 0,${sizePx}" fill="${color}" stroke="${color}" stroke-width="1"/>
      </svg>`;
    const html = `<div style="width:${sizePx}px;height:${sizePx}px;display:inline-block;transform:rotate(${angleDeg}deg);">${svg}</div>`;
    const icon = L.divIcon({
      className: 'arrow-icon',
      html: html,
      iconSize: [sizePx, sizePx],
      iconAnchor: [half, half] // center the icon on the latlng
    });
    return L.marker(latlng, { icon: icon, interactive: false }).addTo(map);
  }


  function startMeasure(e) {
    // if no start point -> start new measurement
    if (!refPoint) {
      refPoint = e.latlng;

      // replace marker with small arrow tip (temporary start marker)
      //measureMarker = makeArrow(refPoint, 0, 18, /*color*/ measureLine && measureLine.options && measureLine.options.color || '#000');


      // ensure mousemove live updates are active (they will be if toggle enabled)
      // measureLine will be created/updated in updateMeasure
    } else {
      // finish measurement to clicked point
      var end = e.latlng;

      // remove any transient line (we will create a final one)
      if (measureLine) {
        map.removeLayer(measureLine);
        measureLine = null;
      }

      // create final polyline and final arrow (instead of marker)
      var finalLine = L.polyline([refPoint, end]).addTo(map);
      var d = refPoint.distanceTo(end);
      var az = getBearing(refPoint.lat, refPoint.lng, end.lat, end.lng);
      finalLine.bindTooltip(d.toFixed(1) + ' m · ' + az.toFixed(1) + '°', { permanent: true, offset: [0, -10] }).openTooltip();

      // create small arrow at the end, oriented along bearing
      var lineColor = finalLine.options && finalLine.options.color || '#000';
      var endArrow = makeArrow(end, az, 18, lineColor);

      // store finished measurement for later clearing
      finishedMeasureLines.push(finalLine);
      finishedMeasureMarkers.push(endArrow);

      // remove the start arrow
      if (measureMarker) {
        map.removeLayer(measureMarker);
        measureMarker = null;
      }

      // reset for next measurement
      refPoint = null;
      measureLine = null;
    }
  }


  // live update while moving mouse after a start click
  function updateMeasure(e) {
    if (!refPoint) return;

    // update transient line
    if (measureLine) {
      map.removeLayer(measureLine);
      measureLine = null;
    }

    measureLine = L.polyline([refPoint, e.latlng]).addTo(map);

    // compute metrics
    var d = refPoint.distanceTo(e.latlng);
    var az = getBearing(refPoint.lat, refPoint.lng, e.latlng.lat, e.latlng.lng);

    // transient tooltip (non-permanent while dragging)
    measureLine.bindTooltip(d.toFixed(1) + ' m · ' + az.toFixed(1) + '°', { permanent: false, offset: [0, -10] }).openTooltip();
  }

  // wire/unwire listeners when toggle changes
  measureToggle.onchange = function(e) {
    measureMode = e.target.checked;
    // when enabling, clear all previous measurements per your request
    if (measureMode) {
      clearAllMeasurements();
      map.on('click', startMeasure);
      map.on('mousemove', updateMeasure);
    } else {
      map.off('click', startMeasure);
      map.off('mousemove', updateMeasure);
      // optionally clear any transient measurement
      clearCurrentMeasurement();
    }
  };




  // 3) clearMeasure
  function clearMeasure() {
    if (measureLine) {
      map.removeLayer(measureLine);
    }
    if (measureMarker) {
      map.removeLayer(measureMarker);
    }
    refPoint = null;
    measureLine = null;
    measureMarker = null;
  }

  // 4) startMeasure
  // function startMeasure(e) {
  //   if (!refPoint) {
  //     refPoint = e.latlng;
  //     measureMarker = L.marker(refPoint).addTo(map);
  //   } else {
  //     map.off('mousemove', updateMeasure);
  //   }
  // }



  // 5) updateMeasure
  // function updateMeasure(e) {
  //   if (!refPoint) return;
  //   if (measureLine) {
  //     map.removeLayer(measureLine);
  //   }
  //   measureLine = L.polyline([refPoint, e.latlng]).addTo(map);
  //   var d = refPoint.distanceTo(e.latlng).toFixed(1);
  //   measureLine.bindTooltip(d + ' m', { permanent: true, offset: [0, -10] }).openTooltip();
  // }




  // 6) parseCoord
  function parseCoord(input) {
    var nums = input.match(/-?\\d+\\.?\\d*/g);
    if (!nums || nums.length < 2) return null;
    var a = parseFloat(nums[0]);
    var b = parseFloat(nums[1]);
    var lat = a, lon = b;
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
      lat = b; lon = a;
    }
    return [lat, lon];
  }

  // 7) inAsean
  function inAsean(lat, lon) {
    return lat >= -11 && lat <= 29 && lon >= 92 && lon <= 141;
  }

  // 8) bindFeature
  function bindFeature(layer) {
    layer.on('contextmenu', function(e) {
      e.originalEvent.preventDefault();
      showContext(e, true);
    });
  }

  // 9) showContext
// --- showContext: centralized context menu for map & features ---
function showContext(e, isFeature) {
  contextMenu.style.display = 'none';
  contextMenu.innerHTML = '';

  // helpers
  function writeToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        if (typeof fallbackCopyText === 'function') return fallbackCopyText(text);
        window.prompt('Copy this text (Ctrl/Cmd+C then Enter):', text);
      });
    } else {
      if (typeof fallbackCopyText === 'function') return fallbackCopyText(text);
      window.prompt('Copy this text (Ctrl/Cmd+C then Enter):', text);
    }
  }

  // Copy LatLon
  var copyLatLon = document.createElement('div');
  copyLatLon.textContent = 'Copy LatLon';
  copyLatLon.onclick = function () {
    var text = e.latlng.lat.toFixed(5) + '\t' + e.latlng.lng.toFixed(5);
    writeToClipboard(text);
    contextMenu.style.display = 'none';
  };
  contextMenu.appendChild(copyLatLon);

  // Copy LonLat
  var copyLonLat = document.createElement('div');
  copyLonLat.textContent = 'Copy LonLat';
  copyLonLat.onclick = function () {
    var text = e.latlng.lng.toFixed(5) + '\t' + e.latlng.lat.toFixed(5);
    writeToClipboard(text);
    contextMenu.style.display = 'none';
  };
  contextMenu.appendChild(copyLonLat);


  // --- add: context checkbox for Always show / Show all (reuse toggleAlwaysShow) ---
  var alwaysDiv = document.createElement('div');
  alwaysDiv.style.display = 'flex';
  alwaysDiv.style.alignItems = 'center';
  var aChk = document.createElement('input');
  aChk.type = 'checkbox';
  aChk.id = 'ctxAlwaysChk';
  aChk.checked = !!toggleAlwaysShow.checked;
  aChk.style.marginRight = '8px';
  aChk.onchange = function () {
    toggleAlwaysShow.checked = aChk.checked;
    // reuse existing logic for toggleAlwaysShow
    toggleAlwaysShow.dispatchEvent(new Event('change'));
  };
  var aLabel = document.createElement('label');
  aLabel.htmlFor = 'ctxAlwaysChk';
  aLabel.textContent = ' Show Sites';
  alwaysDiv.appendChild(aChk);
  alwaysDiv.appendChild(aLabel);
  contextMenu.appendChild(alwaysDiv);



  // --- add: context checkbox for Show sectors (reuse toggleSectors) ---
  var sectorsDiv = document.createElement('div');
  sectorsDiv.style.display = 'flex';
  sectorsDiv.style.alignItems = 'center';
  var sChk = document.createElement('input');
  sChk.type = 'checkbox';
  sChk.id = 'ctxSectorsChk';
  sChk.checked = !!toggleSectors.checked;
  sChk.style.marginRight = '8px';
  sChk.onchange = function () {
    toggleSectors.checked = sChk.checked;
    // reuse existing logic
    toggleSectors.dispatchEvent(new Event('change'));
  };
  var sLabel = document.createElement('label');
  sLabel.htmlFor = 'ctxSectorsChk';
  sLabel.textContent = ' Sectors';
  sectorsDiv.appendChild(sChk);
  sectorsDiv.appendChild(sLabel);
  contextMenu.appendChild(sectorsDiv);

  // Measure distance (checkbox) — toggle the panel checkbox so existing logic is reused
  var measureDiv = document.createElement('div');
  measureDiv.style.display = 'flex';
  measureDiv.style.alignItems = 'center';
  var chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.id = 'ctxMeasureChk';
  chk.checked = !!measureToggle.checked;
  chk.style.marginRight = '8px';
  chk.onchange = function () {
    measureToggle.checked = chk.checked;
    // trigger the existing change handler (dispatch event)
    measureToggle.dispatchEvent(new Event('change'));
  };
  var label = document.createElement('label');
  label.htmlFor = 'ctxMeasureChk';
  label.textContent = ' Measure distance';
  measureDiv.appendChild(chk);
  measureDiv.appendChild(label);
  contextMenu.appendChild(measureDiv);


  // Clear measurement
  var clearDiv = document.createElement('div');
  clearDiv.textContent = 'Clear measurement';
  clearDiv.onclick = function () {
    if (typeof clearAllMeasurements === 'function') clearAllMeasurements();
    contextMenu.style.display = 'none';
  };
  contextMenu.appendChild(clearDiv);



  // Add point input (use existing gotoBtn logic by setting gotoInput and triggering its click)
  var addWrap = document.createElement('div');
  addWrap.style.display = 'flex';
  addWrap.style.gap = '6px';
  var ctxAdd = document.createElement('input');
  ctxAdd.type = 'text';
  ctxAdd.placeholder = 'lon,lat or lat,lon';
  ctxAdd.style.flex = '1';
  var ctxAddBtn = document.createElement('button');
  ctxAddBtn.textContent = 'Add';
  ctxAddBtn.onclick = function () {
    var v = (ctxAdd.value || '').trim();
    if (!v) return;
    gotoInput.value = v;
    try { gotoBtn.click(); } catch (err) { if (typeof gotoBtn.onclick === 'function') gotoBtn.onclick(); }
    contextMenu.style.display = 'none';
  };
  ctxAdd.addEventListener('keydown', function(evt){
    if (evt.key === 'Enter') ctxAddBtn.click();
  });
  addWrap.appendChild(ctxAdd);
  addWrap.appendChild(ctxAddBtn);
  contextMenu.appendChild(addWrap);


  // Search input (jump to first match)
  var searchWrap = document.createElement('div');
  searchWrap.style.display = 'flex';
  searchWrap.style.gap = '6px';
  var ctxSearch = document.createElement('input');
  ctxSearch.type = 'text';
  ctxSearch.placeholder = 'Search siteid or name';
  ctxSearch.style.flex = '1';
  var ctxSearchBtn = document.createElement('button');
  ctxSearchBtn.textContent = 'OK';
  ctxSearchBtn.onclick = function () {
    var term = (ctxSearch.value || '').trim().toLowerCase();
    if (!term) return;
    // query DB and go to first result
    db.sites.filter(function (s) {
      return s.siteId.toLowerCase().indexOf(term) !== -1 ||
             s.sitename.toLowerCase().indexOf(term) !== -1;
    }).toArray().then(function (matches) {
      if (matches && matches.length > 0) {
        var site = matches[0];
        map.setView([site.lat, site.lon], +zoomSlider.value);
        site.azimuths = (String(site.azRaw || '')).split(';').map(Number).filter(function(n){return !isNaN(n);});
        currentSites = [site];
        drawAllSectors();
      } else {
        // optional: small visual feedback
        ctxSearch.style.borderColor = 'red';
        setTimeout(()=> ctxSearch.style.borderColor = '', 800);
      }
      contextMenu.style.display = 'none';
    }).catch(function(){
      contextMenu.style.display = 'none';
    });
  };
  
/* ----------  Insert after ctxSearchBtn.onclick block ---------- */

/* Reusable function: go to siteId (ES5) */
function gotoSiteById(siteId) {
  if (!siteId) return;
  // normalize
  var term = String(siteId).trim().toLowerCase();

  // Query local DB and go to first match (same behavior as your context search)
  db.sites.filter(function (s) {
    return (s.siteId || '').toLowerCase().indexOf(term) !== -1 ||
           (s.sitename || '').toLowerCase().indexOf(term) !== -1;
  }).toArray().then(function (matches) {
    if (matches && matches.length > 0) {
      var site = matches[0];
      map.setView([site.lat, site.lon], +zoomSlider.value);
      site.azimuths = (String(site.azRaw || '')).split(';')
                       .map(function(n){ return parseFloat(n); })
                       .filter(function(n){ return !isNaN(n); });
      currentSites = [site];
      drawAllSectors();
    } else {
      // optional: small visual feedback if not found
      console.warn('gotoSiteById: not found', siteId);
    }
  }).catch(function(err){
    console.error('gotoSiteById error', err);
  });
}



/* Optional: notify parent that iframe is ready (useful so parent waits before sending) */
function notifyParentReady() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'btsmapReady' }, '*'); // replace '*' with parent origin if known
    }
  } catch (e) {}
}
document.addEventListener('DOMContentLoaded', function(){ notifyParentReady(); });




/* Query param fallback: if loaded with ?siteid=XXX call gotoSiteById */
(function () {
  function getParam(name) {
    var m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }
  var q = getParam('siteid');
  if (q) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      gotoSiteById(q);
    } else {
      document.addEventListener('DOMContentLoaded', function () { gotoSiteById(q); });
    }
  }
})();


  
  ctxSearch.addEventListener('keydown', function(evt){
    if (evt.key === 'Enter') ctxSearchBtn.click();
  });
  searchWrap.appendChild(ctxSearch);
  searchWrap.appendChild(ctxSearchBtn);
  contextMenu.appendChild(searchWrap);


  // optional feature-specific item
  if (isFeature) {
    var infoDiv = document.createElement('div');
    infoDiv.textContent = 'Show info';
    infoDiv.onclick = function () {
      contextMenu.style.display = 'none';
      infoPopup.style.display = 'block';
    };
    contextMenu.appendChild(infoDiv);

    // NEW: Change label menu item (id used by per-marker handler)
    var changeDiv = document.createElement('div');
    changeDiv.id = 'changeLabel';
    changeDiv.textContent = 'Change label';
    // optional: give minimal built-in action as fallback (per-marker handler will override this onclick)
    changeDiv.onclick = function () {
      contextMenu.style.display = 'none';
    };
    contextMenu.appendChild(changeDiv);
  }


  // position & show
  contextMenu.style.top = e.containerPoint.y + 'px';
  contextMenu.style.left = e.containerPoint.x + 'px';
  contextMenu.style.display = 'block';
}

//sampai sini

    map.on('contextmenu',e=>{ e.originalEvent.preventDefault(); showContext(e,false); });
    map.off('mousemove'); 
    //map.on('mousemove',e=>{ coordDisplay.textContent = `${e.latlng.lat.toFixed(5)} ${e.latlng.lng.toFixed(5)}`; });
    let elevTimer;
    map.on('mousemove', function (e) {
      var lat = e.latlng.lat.toFixed(5),
          lon = e.latlng.lng.toFixed(5);

      clearTimeout(elevTimer);
      elevTimer = setTimeout(function () {        
		coordDisplay.textContent = `${e.latlng.lat.toFixed(5)} ${e.latlng.lng.toFixed(5)}`;
		return
		        
      }, 10);
    });

    map.on('click',()=>{ contextMenu.style.display='none'; }); document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ contextMenu.style.display='none'; infoPopup.style.display='none'; }});
    infoClose.onclick = ()=>{ infoPopup.style.display='none'; };

    zoomSlider.oninput = e=>{ map.setZoom(+e.target.value); };
    map.on('zoomend', ()=>{ zoomSlider.value = map.getZoom(); });
    //rangeSlider.oninput = e=>{ range = +e.target.value; drawSectors(); };
    rangeSlider.oninput = e => {
      range = +e.target.value;
      drawAllSectors();   // ← new: redraw with updated range
    };

    themeSelect.onchange = e=>{ currentTheme = e.target.value; if(currentTheme!=='2') Object.keys(siteColors).forEach(k=>delete siteColors[k]); drawAllSectors(); };

    // measureToggle.onchange = e=>{ measureMode = e.target.checked; clearMeasure(); if(measureMode){ map.on('click',startMeasure); map.on('mousemove',updateMeasure); } else { map.off('click',startMeasure); map.off('mousemove',updateMeasure); } };

    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();      // stop any form-submit or default behavior
        searchBtn.click();       // trigger your existing handler
      }
    });

    gotoInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();      // stop any form-submit or default behavior
        gotoBtn.click();       // trigger your existing handler
      }
    });

    gotoInput.addEventListener('paste', function(e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');

      // 1. Tokenize on any non-[0-9 . -] chars
      const toks = text.split(/[^0-9.\-]+/);
      //console.log(toks);
      // 2. Keep only signed decimal-point tokens
      const decs = toks.filter(t => /^-?\d+\.\d+$/.test(t));
      //console.log(decs);
      // 3. Group into [long, lat] or [lat, long] pairs
      const pairs = [];
      for (let i = 0; i + 1 < decs.length; i += 2) {
        pairs.push(`${decs[i]} ${decs[i + 1]}`);
      }
      // console.log(pairs);
      
      // 4. Deduplicate, preserving first-seen order
      const seen = new Set();
      const unique = [];
      for (const p of pairs) {
        if (!seen.has(p)) {
          seen.add(p);
          unique.push(p);
        }
      }
      // console.log(unique);
      // 5. Output all unique pairs      
      this.value = this.value + ' ' + unique.join(' ');
    });


		gotoBtn.onclick = function(){
			var nums = (gotoInput.value.match(/-?\d+\.?\d*/g) || []).map(Number);
			var newMarkers = [];

			for (var i = 0; i + 1 < nums.length; i += 2) {
				var a = nums[i], b = nums[i+1];
				var lat = Math.abs(a) <= 90 && Math.abs(b) > 90 ? a : b;
				var lon = lat === a ? b : a;
				if (!inAsean(lat, lon)) continue;

				var idx    = pointMarkers.length + 1;
				var size   = Math.round(currentTextSize * 1.5); // 1.8× font-size
				var html =
				'<span style="font-size:' + size + 'px;'
				+ '-webkit-text-stroke:1px white;'
				+ 'text-stroke:3px black;'
				+ 'color:red;'
				+ 'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,'
				+           '-1px 1px 0 #000,1px 1px 0 #000;">'
				+   '<span class="blinking">★</span>'
				+   idx
				+ '</span>';

				// apply no-bg to strip out white box
				var marker = L.marker([lat, lon], {
				icon: L.divIcon({
					className: 'no-bg',
					html:      html,
					iconAnchor: [0, 0]
				})
				}).addTo(map);

				pointMarkers.push(marker);
				newMarkers.push(marker);


				if (newMarkers.length === 0) return;

				if (newMarkers.length === 1) {
				map.flyTo(
					newMarkers[0].getLatLng(),
					map.getMaxZoom(),
					{ animate: true, duration: 2 }
				);
				} else {
				const bounds = L.latLngBounds(newMarkers.map(m => m.getLatLng()));
				map.fitBounds(bounds, { padding: [20, 20], animate: true, duration: 2 });
				}


			(function(m, index, labelSize){
				m.on('contextmenu', function(e) {
          e.originalEvent.preventDefault();

          showContext(e, true);



          // Fallback using a temporary textarea + document.execCommand('copy')
          function fallbackCopyText(text) {
            try {
              const ta = document.createElement('textarea');
              ta.value = text;
              // Avoid page scrolling to bottom on iOS by making textarea small & offscreen
              ta.style.position = 'fixed';
              ta.style.left = '-9999px';
              ta.style.top = '0';
              document.body.appendChild(ta);
              ta.focus();
              ta.select();

              const ok = document.execCommand('copy');
              document.body.removeChild(ta);

              if (!ok) {
                // final fallback: let user manually copy by prompting
                window.prompt('Copy this text (Ctrl/Cmd+C then Enter):', text);
              }
            } catch (e) {
              try { document.body.removeChild(ta); } catch(_) {}
              window.prompt('Copy this text (Ctrl/Cmd+C then Enter):', text);
            }
          }


          // closure holds m, index, labelSize
          document.getElementById('changeLabel').onclick = function() {
          var newLabel = prompt('New label', index);
          if (newLabel) {
            // use labelSize from closure
            var newHtml =
            '<span style="font-size:' + labelSize + 'px;'
            + '-webkit-text-stroke:1px white;'
            + 'text-stroke:1px black;'
            + 'color:lime;'
            + 'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,'
            +           '-1px 1px 0 #000,1px 1px 0 #000;">'
            + '★' + newLabel
            + '</span>';
            m.setIcon(L.divIcon({
            className: 'no-bg',
            html:      newHtml,
            iconAnchor: [0, 0]
            }));
          }
          contextMenu.style.display = 'none';
          };
        });
			})(marker, idx, size);

		}
	};


  (function(){
    const container = document.getElementById('searchResults');
    if (!container) return;

    // helper: get siteid from row (expects attribute data-siteid or .siteid element)
    function getSiteIdFromRow(row) {
      if (!row) return null;
      if (row.dataset && row.dataset.siteid) return row.dataset.siteid;
      const el = row.querySelector('.siteid');
      return el ? el.textContent.trim() : null;
    }

    // delegate mouseenter/mouseleave to add hover class only when not pinned
    container.addEventListener('pointerenter', e => {
      const row = e.target.closest('.result-row');
      if (!row) return;
      if (row.classList.contains('pinned')) return;
      row.classList.add('hovered');
    }, true);

    container.addEventListener('pointerleave', e => {
      const row = e.target.closest('.result-row');
      if (!row) return;
      row.classList.remove('hovered');
    }, true);

    // clear any lingering hovered on scroll
    container.addEventListener('scroll', () => {
      container.querySelectorAll('.result-row.hovered').forEach(r => r.classList.remove('hovered'));
    });

    // click toggles pinned state and dispatches custom event
    container.addEventListener('click', e => {
      const row = e.target.closest('.result-row');
      if (!row) return;
      const siteid = getSiteIdFromRow(row);

      // toggle pinned
      const pinned = row.classList.toggle('pinned');

      // if pinned, ensure hover class removed and stay highlighted
      if (pinned) {
        row.classList.remove('hovered');
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        // panel -> collapsed & position results
        showSearchResultsAtPanel();
      } else {
        // restore panel when unpinned
        setPanelCollapsed(false);
      }

      // dispatch a clear, uniform event for your existing app code to use
      const ev = new CustomEvent('searchResultSelected', {
        detail: { siteid: siteid, element: row, pinned: pinned }
      });
      window.dispatchEvent(ev);

      // If your app previously had a global function for selection, call it safely
      if (typeof window.onSearchResultClick === 'function') {
        try { window.onSearchResultClick(siteid, row, pinned); } catch(e){ console.warn(e); }
      }
    });
  })();  