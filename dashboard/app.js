// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the board, a detail view for every protocol, filters, the
// live-token comparison and the method. No network: every byte it shows is in
// data.js. Views are hash routes, so each one opens from a plain URL:
//   index.html#/board                          the ranked board
//   index.html#/board?category=Lending         the board, filtered
//   index.html#/board?chain=Solana&q=stake     search + chain filter
//   index.html#/detail/<slug>                  one protocol's detail view
//   index.html#/live                           protocols whose token already trades
//   index.html#/method                         how the implied value is computed
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var PAGE_SIZE = 50;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtRatio(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- routing -------------------------------------------------------------
  // Hash forms: #/board, #/board?category=X&chain=Y&q=Z&sort=S&page=N,
  // #/detail/<slug>, #/live, #/method. Query values are URL-decoded.
  function parseRoute() {
    var raw = window.location.hash.replace(/^#\/?/, '');
    var parts = raw.split('?');
    var path = parts[0] || 'board';
    var params = new URLSearchParams(parts[1] || '');
    var route = { view: 'board', slug: null, q: '', category: 'all', chain: 'all', minTvl: 0, sort: 'implied', dir: -1, page: 1 };
    if (path.indexOf('detail/') === 0) {
      route.view = 'detail';
      route.slug = decodeURIComponent(path.slice('detail/'.length));
    } else if (path === 'live') {
      route.view = 'live';
    } else if (path === 'method') {
      route.view = 'method';
    } else {
      route.view = 'board';
      route.q = params.get('q') || '';
      route.category = params.get('category') || 'all';
      route.chain = params.get('chain') || 'all';
      route.minTvl = parseInt(params.get('minTvl') || '0', 10) || 0;
      route.sort = params.get('sort') || 'implied';
      route.dir = params.get('dir') === 'asc' ? 1 : -1;
      route.page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    }
    return route;
  }

  function boardHash(route) {
    var params = new URLSearchParams();
    if (route.q) params.set('q', route.q);
    if (route.category !== 'all') params.set('category', route.category);
    if (route.chain !== 'all') params.set('chain', route.chain);
    if (route.minTvl) params.set('minTvl', String(route.minTvl));
    if (route.sort !== 'implied') params.set('sort', route.sort);
    if (route.dir === 1) params.set('dir', 'asc');
    if (route.page > 1) params.set('page', String(route.page));
    var qs = params.toString();
    return '#/board' + (qs ? '?' + qs : '');
  }
  function go(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  // ---- data helpers --------------------------------------------------------
  function watchlistSet() {
    return DATA.rows.filter(function (r) { return r.rank <= DATA.watchlist_size; });
  }
  function filteredRows(route) {
    var q = route.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (route.category !== 'all' && (r.category || 'Other') !== route.category) return false;
      if (route.chain !== 'all' && (r.chains || []).indexOf(route.chain) < 0) return false;
      if (route.minTvl && r.tvl_usd < route.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list, route) {
    var key = route.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -route.dir;
      if (av > bv) return route.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function categories() {
    return Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  }
  function chains() {
    var set = new Set();
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { set.add(c); }); });
    return Array.from(set).sort();
  }

  // ---- shared chrome -------------------------------------------------------
  function header(route) {
    var nav = el('nav', { class: 'tabs', 'aria-label': 'Views' },
      el('a', { href: '#/board', 'aria-current': route.view === 'board' ? 'page' : null, text: 'Board' }),
      el('a', { href: '#/live', 'aria-current': route.view === 'live' ? 'page' : null, text: 'Live tokens' }),
      el('a', { href: '#/method', 'aria-current': route.view === 'method' ? 'page' : null, text: 'How it works' })
    );
    return el('div', null,
      el('header', { class: 'top' },
        el('div', { class: 'brand' },
          el('span', { class: 'mark', 'aria-hidden': 'true' }),
          el('span', null, 'Token Radar ', el('small', { text: 'PRE-TOKEN LAUNCH BOARD' }))
        ),
        el('div', { class: 'top-meta' },
          el('span', { class: 'chip', html: 'Snapshot <b>' + esc(DATA.as_of) + '</b>' }),
          el('span', { class: 'chip', html: 'Model <b>' + esc(DATA.model_version) + '</b>' }),
          el('span', { class: 'chip', html: '<b>' + DATA.board_size + '</b> protocols ranked' })
        )
      ),
      nav
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('h1', { html: 'The next token launches, ranked by what they would be <em>worth</em>.' }),
      el('p', { html: '<b>' + DATA.watchlist_size + ' watchlist protocols</b> hold at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and have no token on record — and the early radar adds <b>' + DATA.early_size + ' more</b> pre-token protocols below that floor. Each one is priced the way the market prices its own kind: the median market-cap-to-TVL ratio of live protocols in its category, scaled to its TVL, its 7-day growth and how long it has run with no token.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('i', { text: 'every slug, none missing' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('i', { text: 'watchlist + early radar' })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('i', { text: top ? top.name : '' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }), el('i', { text: 'already trading, shown apart' }))
      )
    );
  }

  function spotlight() {
    var top5 = DATA.rows.slice(0, 5);
    return el('section', { class: 'spot' },
      el('h2', { text: 'Top 5 by implied value' }),
      el('p', { class: 'sub', text: 'The launches that would matter most, if the protocol’s record stayed as it is. Select one for its model and farm plan.' }),
      el('div', { class: 'spot-cards' }, top5.map(function (r) {
        return el('a', { class: 'spot-card', href: '#/detail/' + encodeURIComponent(r.slug) },
          el('span', { class: 'rk', text: 'RANK ' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'meta', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) })
        );
      }))
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '; the snapshot is sealed and never updated, so the board is a reading of that one day.' }),
      el('p', { text: 'Implied value is this radar’s model, not a price and not a promise: it does not predict whether or when a protocol issues a token. Farm plans farm the protocol; a launch, if it ever comes, is the protocol’s decision.' }),
      el('p', { text: 'Model ' + DATA.model_version + ': implied = TVL × peer multiple × growth × maturity. Peer multiples come from the live-token protocols in this same snapshot.' })
    );
  }

  // ---- board view ----------------------------------------------------------
  function controls(route) {
    var cats = categories();
    var chs = chains();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: route.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      var next = Object.assign({}, route, { q: search.value, page: 1 });
      window.history.replaceState(null, '', boardHash(next));
      render();
    });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === route.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () {
      go(boardHash(Object.assign({}, route, { category: catSel.value, page: 1 })));
    });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chs.map(function (c) { return el('option', { value: c, text: c, selected: c === route.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () {
      go(boardHash(Object.assign({}, route, { chain: chainSel.value, page: 1 })));
    });
    var tvlSel = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: route.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: route.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: 'TVL $500M+', selected: route.minTvl === 500000000 ? 'selected' : null }),
      el('option', { value: '1000000000', text: 'TVL $1B+', selected: route.minTvl === 1000000000 ? 'selected' : null })
    );
    tvlSel.addEventListener('change', function () {
      go(boardHash(Object.assign({}, route, { minTvl: parseInt(tvlSel.value, 10), page: 1 })));
    });
    var count = el('span', { class: 'count' });
    return { node: el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Size' }), tvlSel),
      count
    ), count: count };
  }

  function sortHeader(route, key, label) {
    var btn = el('button', { type: 'button' }, label,
      route.sort === key ? el('span', { 'aria-hidden': 'true', text: route.dir < 0 ? ' ↓' : ' ↑' }) : null
    );
    btn.addEventListener('click', function () {
      var next = Object.assign({}, route, { page: 1 });
      if (route.sort === key) next.dir = -route.dir;
      else { next.sort = key; next.dir = -1; }
      go(boardHash(next));
    });
    return el('th', { scope: 'col' }, btn);
  }

  function boardView(route) {
    var list = sortedRows(filteredRows(route), route);
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    var page = Math.min(route.page, pages);
    var slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header(route));
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    var ctl = controls(route);
    ctl.count.innerHTML = '<b>' + total + '</b> of ' + DATA.board_size + ' rows shown';
    shell.appendChild(ctl.node);
    var filtered = route.q || route.category !== 'all' || route.chain !== 'all' || route.minTvl;
    if (filtered) {
      var desc = [];
      if (route.q) desc.push('search “' + route.q + '”');
      if (route.category !== 'all') desc.push('category ' + route.category);
      if (route.chain !== 'all') desc.push('chain ' + route.chain);
      if (route.minTvl) desc.push('TVL ' + fmtUsd(route.minTvl) + '+');
      shell.appendChild(el('p', { class: 'sub', html: 'Filtered view: ' + esc(desc.join(' · ')) + ' — <a href="#/board">clear filters</a>' }));
    }
    if (slice.length === 0) {
      shell.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('a', { class: 'button primary', href: '#/board', text: 'Clear filters' })
      )));
    } else {
      var max = DATA.rows[0].implied_value_usd || 1;
      var tbody = el('tbody');
      slice.forEach(function (r) {
        var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
        var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
        var isWatch = r.rank <= DATA.watchlist_size;
        var tr = el('tr', {
          tabindex: '0',
          onclick: function () { go('#/detail/' + encodeURIComponent(r.slug)); },
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('#/detail/' + encodeURIComponent(r.slug)); } }
        },
          el('td', { class: 'num', html: String(r.rank) + (isWatch ? ' <span class="tag-watch" title="On the watchlist">●</span>' : '') }),
          el('td', null, el('div', { class: 'name' },
            el('b', { text: r.name }),
            el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
          )),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + growthClass, text: growth }),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', null, el('div', { class: 'implied' },
            el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          )),
          el('td', null, el('span', { class: 'status', text: 'no token' }))
        );
        tbody.appendChild(tr);
      });
      var panel = el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. ● marks a watchlist protocol.' }),
            el('thead', null, el('tr', null,
              sortHeader(route, 'implied', 'Rank'),
              sortHeader(route, 'name', 'Protocol'),
              sortHeader(route, 'tvl', 'TVL'),
              sortHeader(route, 'growth', '7d'),
              sortHeader(route, 'age', 'Age'),
              sortHeader(route, 'implied', 'Implied value'),
              el('th', { scope: 'col', text: 'Token' })
            )),
            tbody
          )
        )
      );
      if (pages > 1) {
        var pager = el('div', { class: 'pager' });
        if (page > 1) pager.appendChild(el('a', { class: 'button', href: boardHash(Object.assign({}, route, { page: page - 1 })), text: '← Previous' }));
        pager.appendChild(el('span', { text: 'Page ' + page + ' of ' + pages }));
        if (page < pages) pager.appendChild(el('a', { class: 'button', href: boardHash(Object.assign({}, route, { page: page + 1 })), text: 'Next →' }));
        panel.appendChild(pager);
      }
      shell.appendChild(panel);
      shell.appendChild(modelPanel());
    }
    shell.appendChild(footer());
    return shell;
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot’s own figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: 'implied = round( TVL × peer multiple × (1 + clamp(7d change, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ') )' }),
      el('p', { class: 'sub', text: 'The peer multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category (at least ' + m.min_peers + ' peers, otherwise the overall median of ' + DATA.overall_peer_multiple + '), clamped to [' + m.peer_min + ', ' + m.peer_max + ']. Age is the time since the protocol was first listed; an unlisted age is scored at ' + m.unknown_age_days + ' days. ' }),
      el('p', null, el('a', { href: '#/method', text: 'See the full method and the peer table →' }))
    );
  }

  // ---- detail view ---------------------------------------------------------
  function detailView(route) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === route.slug) row = r; });
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header(route));
    if (!row) {
      shell.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol with that name' }),
        el('p', { text: 'The slug “' + route.slug + '” is not on this board.' }),
        el('a', { class: 'button primary', href: '#/board', text: 'Back to the board' })
      )));
      shell.appendChild(footer());
      return shell;
    }
    var idx = DATA.rows.indexOf(row);
    var prev = idx > 0 ? DATA.rows[idx - 1] : null;
    var next = idx < DATA.rows.length - 1 ? DATA.rows[idx + 1] : null;
    var peer = null;
    (DATA.peers || []).forEach(function (p) { if (p.category === (row.category || 'Other')) peer = p; });
    shell.appendChild(el('a', { class: 'back', href: '#/board', text: '← Back to the board' }));
    shell.appendChild(el('div', { class: 'detail-head' },
      el('div', { class: 'crumbs', html: 'Rank <b>#' + row.rank + '</b> of ' + DATA.board_size + (row.rank <= DATA.watchlist_size ? ' · <b>on the watchlist</b>' : ' · early radar') }),
      el('h1', { text: row.name }),
      el('p', { text: (row.category || 'Other') + ' on ' + ((row.chains && row.chains.length) ? row.chains.join(', ') : 'an unnamed chain') + '. No token on record: no market cap, no CoinGecko id, no symbol.' })
    ));
    shell.appendChild(el('div', { class: 'kv' },
      el('div', { class: 'cell' }, el('span', { text: 'Implied launch value' }), el('b', { text: fmtUsdFull(row.implied_value_usd) }), el('i', { text: 'the model’s claim, not a price' })),
      el('div', { class: 'cell' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsdFull(row.tvl_usd) }), el('i', { text: '7d ' + fmtPct(row.change_7d) })),
      el('div', { class: 'cell' }, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) }), el('i', { text: row.listed_at ? 'listed ' + row.listed_at : 'listing date not recorded' }))
    ));
    shell.appendChild(el('section', { class: 'panel' },
      el('h2', { text: 'Why this number' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsdFull(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'Other') + ')' }), el('b', { text: fmtRatio(row.peer_multiple) + (peer ? ' · ' + peer.peers + (peer.peers === 1 ? ' peer' : ' peers') : '') })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: '7-day change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsdFull(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: peer
        ? 'The peer multiple is the median market-cap-to-TVL ratio of the ' + peer.peers + ' live-token ' + (row.category || 'Other') + ' protocols in this snapshot' + (peer.source === 'overall' ? '; the category had too few live peers, so the overall median is used' : '') + '.'
        : 'The peer multiple is the overall median market-cap-to-TVL ratio of the live-token protocols in this snapshot.' }),
      el('p', { class: 'sub', text: 'The same function scores every protocol on the board. This is an estimate of what a launch would be worth if the protocol’s record stayed as it is — it does not predict whether or when a token is issued.' })
    ));
    var steps = row.farm_steps || [];
    var ol = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      ol.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    shell.appendChild(el('section', { class: 'panel' },
      el('h2', { text: 'Farm plan — how to farm ' + row.name }),
      el('p', { class: 'sub', text: 'Seven steps, sized to this protocol’s TVL, category, chains and age. Nothing here promises a token or an airdrop.' }),
      ol,
      el('div', { class: 'warn' }, el('b', { text: 'Stay safe: ' }), document.createTextNode('only use the protocol’s own pages and the links it publishes. Never pay to claim anything, never paste a seed phrase anywhere, and never trust a claim link sent to you.'))
    ));
    var neigh = el('div', { class: 'neighbors' });
    if (prev) neigh.appendChild(el('a', { class: 'neighbor', href: '#/detail/' + encodeURIComponent(prev.slug) }, el('span', { text: '← Rank ' + prev.rank + ' · higher implied value' }), el('b', { text: prev.name + ' — ' + fmtUsd(prev.implied_value_usd) })));
    if (next) neigh.appendChild(el('a', { class: 'neighbor', href: '#/detail/' + encodeURIComponent(next.slug) }, el('span', { text: 'Rank ' + next.rank + ' → · lower implied value' }), el('b', { text: next.name + ' — ' + fmtUsd(next.implied_value_usd) })));
    shell.appendChild(el('section', { class: 'panel' },
      el('h2', { text: 'Neighbours on the board' }),
      el('p', { class: 'sub', text: 'The protocols ranked just above and below ' + row.name + '.' }),
      neigh
    ));
    shell.appendChild(footer());
    return shell;
  }

  // ---- live view -----------------------------------------------------------
  function liveView(route) {
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header(route));
    shell.appendChild(el('section', { class: 'lede' },
      el('h1', { html: 'Already trading — the market’s <em>own</em> values.' }),
      el('p', { text: 'These protocols already have a token, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are also the comparables the ranking is priced from: each category’s peer multiple is the median market-cap-to-TVL ratio of its live protocols.' })
    ));
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtRatio(r.mcap_tvl_ratio) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    shell.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The ' + DATA.live.length + ' largest live-token protocols by market cap. The last column is the ratio the peer multiples are built from.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    ));
    shell.appendChild(footer());
    return shell;
  }

  // ---- method view ---------------------------------------------------------
  function methodView(route) {
    var m = DATA.model;
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header(route));
    shell.appendChild(el('section', { class: 'lede' },
      el('h1', { html: 'How the radar <em>works</em>.' }),
      el('p', { text: 'Everything on this page is derived from one sealed snapshot of the protocols DefiLlama tracks, dated ' + DATA.as_of + '. The snapshot carries no ranking, no implied value and no farm plan — deriving them is this entry’s work.' })
    ));
    shell.appendChild(el('div', { class: 'method-grid' },
      el('section', { class: 'panel' },
        el('h3', { text: '1 · Who is on the board' }),
        el('p', { text: 'A protocol is ranked when it records no token (no market cap, no CoinGecko id, no symbol), is not a centralised exchange, and is not a versioned pool (a name ending in a release marker such as V2).' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that meets those rules — ' + DATA.watchlist_size + ' of them — is ranked. The early radar adds the other ' + DATA.early_size + ' rankable pre-token protocols below the floor, so the board holds ' + DATA.board_size + ' rows.' }),
        el('p', { text: 'Wrapped, staked and bridged products of a token that already trades are left out by the watchlist’s own definition, and the board keeps them out: a wrapped token is not a token that does not exist yet.' })
      ),
      el('section', { class: 'panel' },
        el('h3', { text: '2 · What a launch would be worth' }),
        el('div', { class: 'formula', text: 'implied = round( TVL × peer multiple × growth × maturity )' }),
        el('p', { text: 'Peer multiple: the median market-cap-to-TVL ratio of the live-token protocols in the same category (at least ' + m.min_peers + ' peers, otherwise the overall median ' + DATA.overall_peer_multiple + '), clamped to [' + m.peer_min + ', ' + m.peer_max + '].' }),
        el('p', { text: 'Growth: 1 + clamp(7-day TVL change, ' + m.growth_floor + '%, ' + m.growth_cap + '%) / 100 × ' + m.growth_weight + '.' }),
        el('p', { text: 'Maturity: ' + m.maturity_floor + ' + min(age in days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '; age is the time since first listing, and an unlisted age is scored at ' + m.unknown_age_days + ' days.' }),
        el('p', { text: 'Ties are separated by a one-dollar step, so implied value falls strictly from rank 1 down. The largest claim is capped at $100T.' })
      )
    ));
    var tbody = el('tbody');
    (DATA.peers || []).forEach(function (p) {
      tbody.appendChild(el('tr', null,
        el('td', { text: p.category }),
        el('td', { class: 'num', text: String(p.peers) }),
        el('td', { class: 'num', text: fmtRatio(p.median_ratio) }),
        el('td', { class: 'num', text: fmtRatio(p.multiple_used) }),
        el('td', { text: p.source === 'category' ? 'category median' : 'overall median (too few peers)' })
      ));
    });
    shell.appendChild(el('section', { class: 'panel' },
      el('h2', { text: 'Peer multiples by category' }),
      el('p', { class: 'sub', text: 'Computed at run time from the live-token protocols in this same snapshot. A category with fewer than ' + m.min_peers + ' live peers falls back to the overall median.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live peers' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Multiple used' }),
            el('th', { scope: 'col', text: 'Source' })
          )),
          tbody
        )
      )
    ));
    shell.appendChild(el('section', { class: 'panel' },
      el('h2', { text: '3 · Farm plans' }),
      el('p', { class: 'sub', text: 'Each row carries seven steps, derived from the protocol’s own record — its category decides the core action, its TVL sizes the capital, its age sets the hold, its chains pick where to farm. Every step names a cost and a time. No step promises a token: the plan farms the protocol, and a launch is the protocol’s decision.' })
    ));
    shell.appendChild(footer());
    return shell;
  }

  // ---- render --------------------------------------------------------------
  function render() {
    var route = parseRoute();
    var view;
    if (route.view === 'detail') view = detailView(route);
    else if (route.view === 'live') view = liveView(route);
    else if (route.view === 'method') view = methodView(route);
    else view = boardView(route);
    app.textContent = '';
    app.appendChild(view);
    app.setAttribute('aria-busy', 'false');
    document.title = route.view === 'detail'
      ? 'Token Radar — ' + (route.slug || '') + ' detail'
      : 'Token Radar — pre-token protocols ranked by implied launch value';
  }

  window.addEventListener('hashchange', render);
  render();
})();
