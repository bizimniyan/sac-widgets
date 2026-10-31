(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js";
    const NONE = "#";
    const CHILD_FILTER = " and (ZBILESEN ne '#' or ZMASRAF_OGESI ne '#')";
    const CHUNK = 40;
    const MAX_HITS = 200;
    const TYPE_LABEL = { M: "Malzeme", B: "Bileşen", A: "Aktivite" };

    const loadScript = (src) => new Promise((resolve, reject) => {
        if (window.Tabulator) return resolve();
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Tabulator yüklenemedi"));
        document.head.appendChild(script);
    });

    const q = (v) => String(v).replace(/'/g, "''");
    const orEq = (field, ids) => "(" + ids.map(id => `${field} eq '${q(id)}'`).join(" or ") + ")";
    const chunks = (arr, n) => {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    };
    const splitList = (text) => String(text || "").split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
    const memberId = (v) => {
        const m = String(v || "").trim().match(/&\[([^\]]*)\]$/);
        return m ? m[1] : String(v || "").trim();
    };
    const fieldOf = (date, param) => `v${date}_${param}`;
    const fmtDate = (d) => /^\d{6}$/.test(d) ? `${d.slice(4)}.${d.slice(0, 4)}` : d;
    const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
    const nfCopy = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6, useGrouping: false });
    const numCopy = (v) => v === undefined || v === null ? "" : nfCopy.format(v);
    const textCopy = (v) => v === undefined || v === null ? "" : v;
    const numFormatter = (cell) => {
        const v = cell.getValue();
        if (typeof v === "string") return v;
        const empty = v === undefined || v === null;
        const el = cell.getElement();
        if (el.classList.contains("dash") !== empty) el.classList.toggle("dash", empty);
        if (!empty) return nf.format(v);
        const d = cell.getData();
        return d._kind === "P" || ((d._kind === "M" || d._kind === "T") && d.desc === null) ? "" : "–";
    };
    const addValue = (target, r) => {
        if (r.ZMIKTAR === null || r.ZMIKTAR === undefined) return;
        const f = fieldOf(r.Date, r.ZPARAMETRE);
        target[f] = (target[f] || 0) + r.ZMIKTAR;
    };
    const errText = (e) => e && e.message ? e.message : String(e);
    const descFormatter = (cell) => {
        const d = cell.getData();
        if (d._kind === "P") return "";
        const el = document.createElement("span");
        if (d.desc === null || d.desc === undefined) {
            el.className = "loading";
            el.innerHTML = d._kind === "T" ? "<i></i>hesaplanıyor…" : "<i></i>yükleniyor…";
        } else {
            el.textContent = d.desc;
        }
        return el;
    };

    const cmpCode = (a, b) => {
        if (/^\d+$/.test(a) && /^\d+$/.test(b) && a.length !== b.length) return a.length - b.length;
        return a < b ? -1 : a > b ? 1 : 0;
    };
    const parseToken = (tok) => {
        const m = tok.indexOf("*") < 0 ? tok.match(/^(.+?)\s*-\s*(.+)$/) : null;
        return m ? { low: m[1].trim(), high: m[2].trim() } : { low: tok, high: "" };
    };
    const tokenText = (s) => s.high ? `${s.low}-${s.high}` : s.low;
    const matcher = (text) => {
        const tests = splitList(text).map(parseToken).map(s => {
            if (s.high) return id => cmpCode(id, s.low) >= 0 && cmpCode(id, s.high) <= 0;
            if (/[*?]/.test(s.low)) {
                const re = new RegExp("^" + s.low.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
                return id => re.test(id);
            }
            return id => id === s.low;
        });
        return tests.length ? id => tests.some(t => t(id)) : null;
    };
    const TYPE_KEYS = ["M", "Y", "H"];
    const TYPE_NAMES = { M: "Mamül", Y: "Yarımamül", H: "Hammadde" };
    const TYPE_SHORT = { M: "M", Y: "YM", H: "HM" };
    const parseTypes = (t) => {
        const s = new Set();
        splitList(t).forEach(x => { const c = x.toLocaleUpperCase("tr-TR").charAt(0); if (TYPE_NAMES[c]) s.add(c); });
        return s.size ? s : null;
    };
    const runPool = async (tasks, n) => {
        let i = 0;
        const worker = async () => { while (i < tasks.length) await tasks[i++](); };
        await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
    };
    const groupLabel = (v) => v ? v : "(boş)";
    const stopEvents = (el) => ["mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "contextmenu"]
        .forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; }
            #status { flex: 0 0 auto; font-size: 11px; color: #9a9a9a; padding: 4px 6px; }
            #status.error { color: #bb0000; white-space: pre-wrap; }
            #table { flex: 1 1 auto; min-height: 0; font-size: 12px; }
            .tabulator { border: 0 !important; background: #fff !important; font-size: 12px; color: #333; }
            .tabulator .tabulator-header { background: #fff !important; border-bottom: 0 !important; color: #333; font-weight: 600; }
            .tabulator .tabulator-header .tabulator-col { background: #fff !important; border-right: 0 !important; }
            .tabulator .tabulator-header .tabulator-col .tabulator-col-content { padding: 6px 8px 6px; }
            .tabulator .tabulator-header .tabulator-col .tabulator-col-content .tabulator-col-title { white-space: normal !important; line-height: 1.25; }
            .tabulator-row .tabulator-cell.soft { font-weight: 400; color: #6e6e6e; }
            .tabulator-row.row-total, .tabulator-row.row-total .tabulator-cell, .tabulator-row.row-total:hover .tabulator-cell.tabulator-frozen { background-color: #f6f6f6 !important; }
            .tabulator-row.row-total { font-weight: 700; color: #1f1f1f; }
            .tabulator-row.row-total .tabulator-cell { background-image: linear-gradient(#bdbdbd, #bdbdbd); }
            .tabulator-row.row-total .tabulator-cell.soft { font-weight: 400; color: #8a8a8a; }
            .tabulator-row .tabulator-cell.pstart, .tabulator .tabulator-header .tabulator-col.pgroup { box-shadow: inset 1px 0 0 #c6c6c6; }
            .tabulator .tabulator-header .tabulator-col:not(.tabulator-col-group)::after { content: ""; position: absolute; left: 3px; right: 3px; bottom: 0; border-bottom: 2px solid #595959; pointer-events: none; }
            .tabulator .tabulator-header .tabulator-col.tabulator-col-group > .tabulator-col-content { color: #7a7a7a; font-weight: 400; }
            .tabulator .tabulator-header .tabulator-col.tabulator-col-group .tabulator-col-group-cols { border-top: 0 !important; }
            .tabulator .tabulator-header .tabulator-frozen.tabulator-frozen-left, .tabulator-row .tabulator-cell.tabulator-frozen.tabulator-frozen-left { border-right: 1px solid #efefef !important; }
            .tabulator .tabulator-tableholder, .tabulator .tabulator-tableholder .tabulator-table { background: #fff !important; color: #333; }
            .tabulator-row, .tabulator-row.tabulator-row-even, .tabulator-row.tabulator-row-odd { background: #fff !important; border-bottom: 0 !important; }
            .tabulator-row .tabulator-cell { border-right: 0 !important; padding: 4px 8px; }
            .tabulator-row .tabulator-cell { background-image: linear-gradient(#ececec, #ececec); background-repeat: no-repeat; background-size: calc(100% - 6px) 1px; background-position: center bottom; }
            .tabulator-row:hover, .tabulator-row:hover .tabulator-cell.tabulator-frozen { background-color: #fafafa !important; }
            .tabulator-row.tabulator-tree-level-0 { font-weight: 600; color: #262626; }
            .tabulator-row:not(.tabulator-tree-level-0) { font-weight: 400; color: #5f5f5f; }
            .tabulator-row.row-activity { color: #8c8c8c; font-style: italic; }
            .tabulator-row.row-placeholder { color: #aaa; }
            .tabulator-row .tabulator-data-tree-control { border: 1px solid #bdbdbd !important; background: #fff !important; }
            .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-expand, .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-expand:after,
            .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-collapse, .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-collapse:after { background: #7a7a7a !important; }
            .tabulator-row .tabulator-data-tree-branch { border-color: #d6d6d6 !important; }
            .tabulator .tabulator-tableholder .tabulator-range-overlay .tabulator-range,
            .tabulator .tabulator-tableholder .tabulator-range-overlay .tabulator-range-cell-active { border-color: #ff0000 !important; }
            .tabulator .tabulator-tableholder .tabulator-range-overlay .tabulator-range.tabulator-range-active::after { background-color: #ff0000 !important; }
            .pop input[type=checkbox] { accent-color: #ff0000; }
            .kod-f input:focus, .kod-f select:focus, .pop input[type=text]:focus { outline: 1px solid #ff0000; outline-offset: 0; border-color: #ff0000; }
            .tabulator-row .tabulator-cell.tabulator-range-selected:not(.tabulator-range-only-cell-selected) { background-color: #ffd9d9 !important; }
            .tabulator .tabulator-header .tabulator-col.tabulator-range-highlight, .tabulator .tabulator-header .tabulator-col.tabulator-range-selected { background: #ffecec !important; color: inherit !important; }
            .tabulator-row .tabulator-cell.dash { color: #cfcfcf; font-weight: 400; }
            .loading { color: #999; font-style: italic; font-weight: normal; font-size: 12px; }
            .loading i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; vertical-align: -1px; border: 2px solid #ddd; border-top-color: #ff0000; border-radius: 50%; animation: spin .8s linear infinite; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .kod-f { display: flex; gap: 3px; margin-top: 6px; }
            .kod-f input { flex: 1 1 auto; min-width: 0; font: 11px Arial, sans-serif; padding: 2px 4px; border: 1px solid #dadada; border-radius: 3px; color: #333; }
            .kod-f select { flex: 0 0 auto; width: 76px; font: 11px Arial, sans-serif; padding: 1px 0; border: 1px solid #dadada; border-radius: 3px; background: #fff; color: #333; }
            .kod-f input.on, .kod-f select.on { border-color: #ff0000; background: #ffe8e8; }
            .kod-f button, .pop button { font: 11px Arial, sans-serif; cursor: pointer; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; }
            .kod-f button { flex: 0 0 22px; padding: 0; line-height: 18px; }
            .kod-f button:hover, .pop button:hover { background: #ffe8e8; }
            .pop { position: absolute; top: 28px; left: 8px; z-index: 20; width: 460px; max-width: calc(100% - 16px); max-height: calc(100% - 36px);
                   display: flex; flex-direction: column; background: #fff; border: 1px solid #bbb; border-radius: 4px; box-shadow: 0 4px 16px rgba(0,0,0,.18); font: 12px Arial, sans-serif; color: #222; }
            .pop[hidden] { display: none; }
            .pop-h { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; font-weight: bold; border-bottom: 1px solid #eee; }
            .pop-h .x { border: 0; font-size: 16px; line-height: 16px; }
            .pop-b { padding: 6px 10px; overflow: auto; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
            .pop-b > * { flex-shrink: 0; }
            .pop-sec { font-weight: bold; margin: 6px 0 4px; color: #444; }
            .pop-sec small { font-weight: normal; color: #888; }
            .sel-row { display: flex; gap: 4px; align-items: center; margin-bottom: 3px; }
            .sel-row input { width: 140px; font: 12px Arial, sans-serif; padding: 2px 4px; border: 1px solid #c4c4c4; border-radius: 3px; }
            .sel-row button { padding: 0 6px; }
            .sel-rows { max-height: 120px; overflow: auto; }
            .link { align-self: flex-start; margin-top: 2px; padding: 1px 8px; }
            #search { font: 12px Arial, sans-serif; padding: 3px 5px; border: 1px solid #c4c4c4; border-radius: 3px; }
            .pop-b > .hits { margin-top: 4px; border: 1px solid #eee; overflow: auto; flex: 1 1 auto; min-height: 90px; }
            .hits label { display: flex; gap: 6px; align-items: center; padding: 2px 6px; cursor: pointer; white-space: nowrap; }
            .hits label:nth-child(even) { background: #fafafa; }
            .hits label:hover { background: #ffe8e8; }
            .hits b { flex: 0 0 72px; font-weight: 600; }
            .hits span { overflow: hidden; text-overflow: ellipsis; color: #444; }
            .hit-info { color: #888; margin-top: 3px; min-height: 14px; }
            .pop-f { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid #eee; }
            .pop-f .sp { flex: 1; }
            .pop-f button { padding: 3px 12px; }
            .pop-f .primary { background: #ff0000; border-color: #ff0000; color: #fff; }
            .pop-f .primary:hover { background: #ff3333; }
            .kod-f .gbtn { flex: 1 1 auto; min-width: 0; text-align: left; padding: 1px 4px !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: normal; }
            .kod-f .gbtn.tbtn { flex: 0 0 auto; width: 84px; }
            .kod-f .gbtn.on { border-color: #ff0000 !important; background: #ffe8e8 !important; }
            .gpop { width: 300px; }
            .gpop .hits b { flex: 1 1 auto; font-weight: normal; overflow: hidden; text-overflow: ellipsis; }
            .gpop .hits span { flex: 0 0 auto; color: #888; }
        </style>
        <div class="wrap">
            <div id="status">Yükleniyor…</div>
            <div id="table"></div>
            <div id="pop" class="pop" hidden>
                <div class="pop-h">Malzeme seçimi <button class="x" id="popClose" title="Kapat">×</button></div>
                <div class="pop-b">
                    <div class="pop-sec">Seçimler <small>(tek kod, 2* veya alt – üst aralık)</small></div>
                    <div id="selRows" class="sel-rows"></div>
                    <button id="addRow" class="link">+ satır</button>
                    <div class="pop-sec">Malzeme ara <small>(kod veya tanım; işaretle = seçimlere ekle)</small></div>
                    <input id="search" type="text" placeholder="örn. 2100253 veya DAVLUMBAZ">
                    <div id="hits" class="hits"></div>
                    <div id="hitInfo" class="hit-info"></div>
                </div>
                <div class="pop-f">
                    <button id="popClear">Temizle</button><span class="sp"></span>
                    <button id="popCancel">İptal</button><button id="popOk" class="primary">Uygula</button>
                </div>
            </div>
            <div id="gpop" class="pop gpop" hidden>
                <div class="pop-h"><span id="gTitle"></span><button class="x" id="gClose" title="Kapat">×</button></div>
                <div class="pop-b">
                    <input id="gSearch" type="text" placeholder="ara">
                    <div id="gList" class="hits"></div>
                    <div id="gInfo" class="hit-info"></div>
                </div>
                <div class="pop-f">
                    <button id="gAll">Tümü</button><button id="gNone">Hiçbiri</button><span class="sp"></span>
                    <button id="gCancel">İptal</button><button id="gOk" class="primary">Uygula</button>
                </div>
            </div>
        </div>
    `;

    class UsmTree extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._root = shadowRoot;
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._table = null;
            this._token = 0;
            this._matFilter = "";
            this._types = new Set(["M", "Y"]);
            this._compSet = new Set();
            this._allIds = [];
            this._ids = [];
            this._desc = { ZMALZEME: new Map(), ZBILESEN: new Map(), ZMASRAF_OGESI: new Map() };
            this._attr = { ZMALZEME: new Map(), ZBILESEN: new Map() };
            this._grp = { 1: null, 2: null };
            this._gHeader = {};
            this._buildKodHeader();
            this._buildGroupHeader(1, "Grup 1");
            this._buildGroupHeader(2, "Grup 2");
            this._initPopup();
            this._initGroupPopup();
        }

        setGroup1Filter(values) {
            this._setGroup(1, values);
        }

        setGroup2Filter(values) {
            this._setGroup(2, values);
        }

        _setGroup(level, values) {
            const list = values instanceof Set ? Array.from(values)
                : typeof values === "string" ? (values.trim() ? values.split(";").map(s => s.trim()) : null)
                : Array.isArray(values) ? values : null;
            this._grp[level] = list && list.length ? new Set(list.map(v => v === "(boş)" ? "" : v)) : null;
            const g = this._grp[level];
            const btn = this._gHeader[level].btn;
            btn.textContent = !g ? "Tümü ▾" : g.size === 1 ? groupLabel(Array.from(g)[0]) + " ▾" : `${g.size} seçili ▾`;
            btn.classList.toggle("on", !!g);
            this._applyFilter();
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if ("materialFilter" in changedProperties) {
                this._matFilter = this.materialFilter || "";
                this._kodInput.value = this._matFilter;
            }
            if ("materialType" in changedProperties || "onlyParents" in changedProperties) {
                this._types = parseTypes(this.materialType) || new Set(this.onlyParents === false ? TYPE_KEYS : ["M", "Y"]);
                this._updateTypeButton();
            }
            if (["providerId", "version", "parameters", "pageSize", "onlyParents", "companyCode", "materialType"].some(k => k in changedProperties)) {
                this._scheduleReload();
            } else if ("materialFilter" in changedProperties) {
                this._applyFilter();
            }
        }

        _scheduleReload() {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => { if (!this._reload(false)) this._applyFilter(); }, 150);
        }

        setMaterialType(type) {
            this._types = parseTypes(type) || new Set(["M", "Y"]);
            this._updateTypeButton();
            this._scheduleReload();
        }

        getMaterialType() {
            return TYPE_KEYS.filter(k => this._types.has(k)).join(",");
        }

        _updateTypeButton() {
            const keys = TYPE_KEYS.filter(k => this._types.has(k));
            const btn = this._kodType;
            btn.textContent = (keys.length === 3 ? "Tümü" : keys.length === 1 ? TYPE_NAMES[keys[0]] : keys.map(k => TYPE_SHORT[k]).join("+")) + " ▾";
            btn.title = keys.map(k => TYPE_NAMES[k]).join(", ");
            btn.classList.toggle("on", !(keys.length === 2 && this._types.has("M") && this._types.has("Y")));
        }

        onCustomWidgetResize() {
            if (this._table) this._table.redraw();
        }

        setMaterialFilter(filter) {
            this._setFilter(filter);
        }

        getMaterialFilter() {
            return this._matFilter;
        }

        refresh() {
            return this._reload(true);
        }

        _loadParams() {
            let version = memberId(this.version);
            if (version && version.indexOf(".") < 0) version = "public." + version;
            const companies = splitList(this.companyCode).map(memberId).filter(Boolean).sort();
            const sig = JSON.stringify([(this.providerId || "").trim(), version, splitList(this.parameters), this.pageSize, this._types.has("H"), companies]);
            return { version, companies, sig };
        }

        _reload(force) {
            const p = this._loadParams();
            if (!force && p.sig === this._loadSig) return false;
            this._loadSig = p.sig;
            this._doReload(p.version, p.companies);
            return true;
        }

        async _doReload(version, companies) {
            if (this._abort) this._abort.abort();
            this._abort = new AbortController();
            const token = ++this._token;
            this._blocks = new Map();
            this._allIds = [];
            this._ids = [];
            this._valCache = new Map();
            this._parentSet = new Set();
            this._childCache = new Map();
            this._failed = false;
            this._attrsReady = false;
            this._attrPromise = null;
            this._matVals = null;
            this._matValsError = null;

            this._pid = (this.providerId || "").trim();
            this._params = splitList(this.parameters);
            this._blockSize = this.pageSize > 0 ? this.pageSize : 200;
            this._onlyParents = !this._types.has("H");

            if (!this._pid || !version || !this._params.length) {
                this._setStatus("Builder panelinden model, versiyon ve parametreleri girin.");
                return;
            }
            this._baseFilter = `Version eq '${q(version)}' and ${orEq("ZPARAMETRE", this._params)}` +
                (companies.length ? ` and ${orEq("ZSIRKET_KODU", companies)}` : "");
            this._setStatus("Malzeme listesi yükleniyor…");

            try {
                await loadScript(TABULATOR_JS);
                const [dateRows, idRows, parentRows, compRows, paramRows] = await Promise.all([
                    this._get("FactDataAggregation", { $select: "Date,ZMIKTAR", $filter: this._baseFilter, $orderby: "Date" }),
                    this._get("FactDataAggregation", {
                        $select: "ZMALZEME,ZMIKTAR",
                        $filter: this._baseFilter + (this._onlyParents ? CHILD_FILTER : ""),
                        $orderby: "ZMALZEME"
                    }),
                    this._onlyParents ? null : this._get("FactDataAggregation", { $select: "ZMALZEME,ZMIKTAR", $filter: this._baseFilter + CHILD_FILTER }),
                    this._get("FactDataAggregation", { $select: "ZBILESEN,ZMIKTAR", $filter: this._baseFilter + " and ZBILESEN ne '#'" }),
                    this._get("ZPARAMETREMaster", { $select: "ID,Description", $filter: orEq("ID", this._params) }).catch(() => [])
                ]);
                this._paramDesc = new Map(paramRows.filter(r => r.Description).map(r => [r.ID, r.Description]));
                if (token !== this._token) return;
                const dates = dateRows.map(r => r.Date).filter(d => d && d !== NONE);
                this._allIds = idRows.map(r => r.ZMALZEME).filter(id => id && id !== NONE);
                if (!dates.length || !this._allIds.length) {
                    this._destroyTable();
                    this._setStatus(`${version}${companies.length ? " / " + companies.join(",") : ""} için bu parametrelerle veri yok.`);
                    return;
                }
                this._allIndex = new Map(this._allIds.map((id, i) => [id, i]));
                this._parentSet = new Set(parentRows ? parentRows.map(r => r.ZMALZEME) : this._allIds);
                this._compSet = new Set(compRows.map(r => r.ZBILESEN));
                this._ids = this._filteredIds();
                this._buildTable(dates, this._ids.map((id, pos) => this._mRow(id, pos)));
                this._loadMaterialValues(token);
                this._loadAllActivityDescriptions();
                this._attrPromise = this._loadParentAttrs(token);
            } catch (e) {
                if (token !== this._token) return;
                this._loadSig = null;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        _filteredIds() {
            const m = matcher(this._matFilter);
            const ty = this._types;
            const t = !(ty.has("M") && ty.has("Y") && (ty.has("H") || this._onlyParents));
            const parents = this._parentSet;
            const comps = this._compSet;
            const g1 = this._attrsReady ? this._grp[1] : null;
            const g2 = this._attrsReady ? this._grp[2] : null;
            const attr = this._attr.ZMALZEME;
            if (!m && !t && !g1 && !g2) return this._allIds.slice();
            return this._allIds.filter(id => (!m || m(id)) &&
                (!t || ty.has(parents.has(id) ? (comps.has(id) ? "Y" : "M") : "H")) &&
                (!g1 || g1.has((attr.get(id) || {}).g1 || "")) &&
                (!g2 || g2.has((attr.get(id) || {}).g2 || "")));
        }

        async _loadParentAttrs(token) {
            const segs = [];
            let cur = [];
            this._allIds.forEach(id => {
                const prev = cur[cur.length - 1];
                const far = prev !== undefined && (!/^\d+$/.test(id) || !/^\d+$/.test(prev) || id.length !== prev.length || Number(id) - Number(prev) > 500);
                if (cur.length && (far || cur.length >= 300)) { segs.push(cur); cur = []; }
                cur.push(id);
            });
            if (cur.length) segs.push(cur);
            try {
                await runPool(segs.map(seg => async () => {
                    if (token !== this._token) return;
                    const rows = await this._get("ZMALZEMEMaster", {
                        $select: "ID,Description,MALZ_GRUP1,MALZ_GRUP2",
                        $filter: seg.length === 1 ? `ID eq '${q(seg[0])}'` : `ID ge '${q(seg[0])}' and ID le '${q(seg[seg.length - 1])}'`
                    });
                    rows.forEach(r => { if (this._allIndex.has(r.ID)) this._storeMaster("ZMALZEME", r); });
                }), 6);
            } catch (e) {
                return;
            }
            if (token !== this._token) return;
            this._attrsReady = true;
            if (this._grp[1] || this._grp[2]) this._applyFilter();
        }

        _storeMaster(dim, r) {
            this._desc[dim].set(r.ID, r.Description || "");
            if (this._attr[dim]) this._attr[dim].set(r.ID, { g1: r.MALZ_GRUP1 || "", g2: r.MALZ_GRUP2 || "" });
        }

        _attrOf(dim, id) {
            const a = this._attr[dim] && this._attr[dim].get(id);
            return a ? { g1: a.g1, g2: a.g2 } : { g1: null, g2: null };
        }

        _setFilter(text) {
            this._matFilter = splitList(text).join("; ");
            this._kodInput.value = this._matFilter;
            this._applyFilter();
        }

        _applyFilter() {
            this._kodInput.classList.toggle("on", !!this._matFilter);
            this._updateTypeButton();
            if (!this._table || !this._allIds.length) return;
            this._ids = this._filteredIds();
            this._blocks = new Map();
            this._table.replaceData([this._totalRow()].concat(this._ids.map((id, pos) => this._mRow(id, pos)))).then(() => this._loadVisible());
            this._updateStatus();
        }

        _computeTotal() {
            if (!this._matVals) return null;
            const sums = { desc: `${nf.format(this._ids.length)} malzeme` };
            this._valueFields.forEach(f => { sums[f] = null; });
            this._ids.forEach(id => {
                const v = this._matVals.get(id);
                if (!v) return;
                for (const f in v) sums[f] = (sums[f] || 0) + v[f];
            });
            return sums;
        }

        _totalRow() {
            const row = { key: "TOTAL", name: "Toplam", type: "", g1: "", g2: "", desc: this._matValsError || null, _kind: "T" };
            this._valueFields.forEach(f => { row[f] = null; });
            return Object.assign(row, this._computeTotal() || {});
        }

        async _loadMaterialValues(token) {
            const vals = new Map();
            try {
                const rows = await this._get("FactDataAggregation", { $select: "ZMALZEME,Date,ZPARAMETRE,ZMIKTAR", $filter: this._baseFilter });
                if (token !== this._token) return;
                rows.forEach(r => {
                    if (!this._allIndex.has(r.ZMALZEME)) return;
                    if (!vals.has(r.ZMALZEME)) vals.set(r.ZMALZEME, {});
                    addValue(vals.get(r.ZMALZEME), r);
                });
            } catch (e) {
                if (token !== this._token) return;
                this._matValsError = "toplam alınamadı";
                this._refreshTotalRow();
                return;
            }
            this._matVals = vals;
            this._refreshTotalRow();
        }

        async _refreshTotalRow() {
            const row = this._table && this._table.getRow("TOTAL");
            if (!row) return;
            await this._table.updateData([this._totalRow()]);
            row.reformat();
        }

        _setStatus(text, isError) {
            this._statusEl.textContent = text;
            this._statusEl.className = isError ? "error" : "";
        }

        _updateStatus() {
            if (this._failed) return;
            const busy = Array.from(this._blocks.values()).some(s => s === "busy");
            const count = this._ids.length === this._allIds.length
                ? nf.format(this._allIds.length)
                : `${nf.format(this._ids.length)} / ${nf.format(this._allIds.length)}`;
            this._setStatus(`${count} malzeme${busy ? " · değerler yükleniyor…" : ""}`);
        }

        _destroyTable() {
            if (this._table) {
                this._table.destroy();
                this._table = null;
            }
            this._tableEl.innerHTML = "";
        }

        async _get(path, params) {
            const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
            let url = `${window.location.origin}/api/v1/dataexport/providers/sac/${encodeURIComponent(this._pid)}/${path}?${qs}`;
            const out = [];
            while (url) {
                const resp = await fetch(url, { method: "GET", credentials: "include", headers: { Accept: "application/json" }, signal: this._abort && this._abort.signal });
                if (!resp.ok) {
                    const body = await resp.text();
                    throw new Error(`HTTP ${resp.status} ${body.slice(0, 300)}`);
                }
                const data = await resp.json();
                const rows = Array.isArray(data) ? data : (data.value || []);
                rows.forEach(r => out.push(r));
                url = Array.isArray(data) ? null : (data["@odata.nextLink"] || null);
            }
            return out;
        }

        async _loadDescriptions(dim, ids) {
            const cache = this._desc[dim];
            const missing = ids.filter(id => !cache.has(id));
            const select = this._attr[dim] ? "ID,Description,MALZ_GRUP1,MALZ_GRUP2" : "ID,Description";
            await Promise.all(chunks(missing, CHUNK).map(async (part) => {
                const rows = await this._get(`${dim}Master`, { $select: select, $filter: orEq("ID", part) });
                part.forEach(id => this._storeMaster(dim, { ID: id }));
                rows.forEach(r => this._storeMaster(dim, r));
            }));
        }

        async _loadAllActivityDescriptions() {
            try {
                const rows = await this._get("ZMASRAF_OGESIMaster", { $select: "ID,Description" });
                rows.forEach(r => this._desc.ZMASRAF_OGESI.set(r.ID, r.Description || ""));
            } catch (e) {
                return;
            }
        }

        _childData(id) {
            if (!this._childCache.has(id)) {
                const p = this._get("FactDataAggregation", {
                    $select: "Date,ZPARAMETRE,ZBILESEN,ZMASRAF_OGESI,ZMIKTAR",
                    $filter: `${this._baseFilter} and ZMALZEME eq '${q(id)}'${CHILD_FILTER}`
                }).then(recs => {
                    const comps = new Map();
                    const acts = new Map();
                    recs.forEach(r => {
                        let map, cid;
                        if (r.ZBILESEN && r.ZBILESEN !== NONE) { map = comps; cid = r.ZBILESEN; }
                        else if (r.ZMASRAF_OGESI && r.ZMASRAF_OGESI !== NONE) { map = acts; cid = r.ZMASRAF_OGESI; }
                        else return;
                        if (!map.has(cid)) map.set(cid, {});
                        addValue(map.get(cid), r);
                    });
                    return { comps, acts };
                });
                p.catch(() => this._childCache.delete(id));
                this._childCache.set(id, p);
            }
            return this._childCache.get(id);
        }

        _prefetch(row) {
            const d = row.getData();
            if (d._kind === "P" || d._kind === "A" || d._loaded || !Array.isArray(d._children)) return;
            this._childData(d._id);
        }

        _row(key, type, id, dim, expandable) {
            const cache = this._desc[dim];
            const desc = type === "M" || !cache.has(id) ? null : cache.get(id);
            const row = Object.assign({ key, type: TYPE_LABEL[type], name: id, desc, _id: id, _kind: type }, this._attrOf(dim, id));
            if (expandable) row._children = [{ key: key + "/…", name: "Yükleniyor…", _kind: "P" }];
            return row;
        }

        _mRow(id, pos) {
            return Object.assign(this._row(`M${id}`, "M", id, "ZMALZEME", this._parentSet.has(id)), this._valCache.get(id) || {}, { _pos: pos });
        }

        _buildKodHeader() {
            const el = document.createElement("div");
            el.innerHTML = `<div>Kod</div><div class="kod-f"><button class="gbtn tbtn"></button>` +
                `<input type="text" placeholder="2*, 21000001-21000999"><button title="Çoklu seçim">⋯</button></div>`;
            const box = el.querySelector(".kod-f");
            this._kodInput = box.querySelector("input");
            this._kodType = box.querySelector(".tbtn");
            stopEvents(box);
            this._kodType.addEventListener("click", () => this._openGroupPopup("T", this._kodType));
            this._updateTypeButton();
            this._kodInput.addEventListener("keydown", e => {
                if (e.key === "Enter") this._setFilter(this._kodInput.value);
                if (e.key === "Escape") { this._kodInput.value = this._matFilter; this._kodInput.blur(); }
            });
            this._kodInput.addEventListener("change", () => this._setFilter(this._kodInput.value));
            box.querySelector("button:not(.tbtn)").addEventListener("click", () => this._openPopup());
            this._kodHeaderEl = el;
        }

        _buildGroupHeader(level, title) {
            const el = document.createElement("div");
            el.innerHTML = `<div></div><div class="kod-f"><button class="gbtn">Tümü ▾</button></div>`;
            el.firstChild.textContent = title;
            const box = el.querySelector(".kod-f");
            const btn = box.querySelector("button");
            stopEvents(box);
            btn.addEventListener("click", () => this._openGroupPopup(level, btn));
            this._gHeader[level] = { el, btn, title };
        }

        _initGroupPopup() {
            const $ = (id) => this._root.getElementById(id);
            this._gpop = $("gpop");
            this._gListEl = $("gList");
            this._gSearchEl = $("gSearch");
            this._gInfoEl = $("gInfo");
            stopEvents(this._gpop);
            const close = () => { this._gpop.hidden = true; };
            $("gClose").addEventListener("click", close);
            $("gCancel").addEventListener("click", close);
            $("gAll").addEventListener("click", () => { this._gValues.forEach(v => this._gEdit.add(v[0])); this._renderGroupList(); });
            $("gNone").addEventListener("click", () => { this._gEdit.clear(); this._renderGroupList(); });
            $("gOk").addEventListener("click", () => {
                if (this._gLevel === "T") {
                    if (!this._gEdit.size) return;
                    close();
                    this.setMaterialType(Array.from(this._gEdit).join(","));
                    return;
                }
                close();
                const all = this._gEdit.size === this._gValues.length;
                this._setGroup(this._gLevel, all ? null : Array.from(this._gEdit));
            });
            this._gSearchEl.addEventListener("input", () => this._renderGroupList());
            this._gListEl.addEventListener("change", (e) => {
                if (e.target.checked) this._gEdit.add(e.target.value);
                else this._gEdit.delete(e.target.value);
                this._gInfoEl.textContent = `${this._gValues.length} değer · ${this._gEdit.size} seçili`;
            });
            this._gpop.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
        }

        async _openGroupPopup(level, btn) {
            this._pop.hidden = true;
            this._gLevel = level;
            this._root.getElementById("gTitle").textContent = (level === "T" ? "Tür" : this._gHeader[level].title) + " seçimi";
            const wrap = this._root.querySelector(".wrap").getBoundingClientRect();
            const r = btn.getBoundingClientRect();
            this._gpop.style.left = Math.max(8, Math.min(r.left - wrap.left, wrap.width - 308)) + "px";
            this._gSearchEl.value = "";
            this._gSearchEl.style.display = level === "T" ? "none" : "";
            this._gListEl.innerHTML = "";
            this._gValues = [];
            this._gpop.hidden = false;
            if (level === "T") {
                const counts = { M: 0, Y: 0, H: 0 };
                this._allIds.forEach(id => { counts[this._parentSet.has(id) ? (this._compSet.has(id) ? "Y" : "M") : "H"]++; });
                this._gValues = TYPE_KEYS.map(k => [k, k === "H" && this._onlyParents ? null : counts[k], TYPE_NAMES[k]]);
                this._gEdit = new Set(this._types);
                this._renderGroupList();
                return;
            }
            if (!this._attrsReady) {
                this._gInfoEl.textContent = "grup bilgileri yükleniyor…";
                if (this._attrPromise) await this._attrPromise;
                if (!this._attrsReady || this._gpop.hidden || this._gLevel !== level) return;
            }
            const key = level === 1 ? "g1" : "g2";
            const counts = new Map();
            this._allIds.forEach(id => {
                const v = (this._attr.ZMALZEME.get(id) || {})[key] || "";
                counts.set(v, (counts.get(v) || 0) + 1);
            });
            this._gValues = Array.from(counts.entries()).sort((a, b) => a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0], "tr"));
            const cur = this._grp[level];
            this._gEdit = new Set(cur ? Array.from(cur) : this._gValues.map(v => v[0]));
            this._renderGroupList();
            this._gSearchEl.focus();
        }

        _renderGroupList() {
            const term = this._gSearchEl.value.trim().toLocaleLowerCase("tr-TR");
            const shown = this._gValues.filter(v => !term || (v[2] || groupLabel(v[0])).toLocaleLowerCase("tr-TR").indexOf(term) >= 0);
            this._gListEl.innerHTML = "";
            const frag = document.createDocumentFragment();
            shown.forEach(([v, n, text]) => {
                const label = document.createElement("label");
                label.innerHTML = `<input type="checkbox"><b></b><span></span>`;
                const cb = label.querySelector("input");
                cb.value = v;
                cb.checked = this._gEdit.has(v);
                label.querySelector("b").textContent = text || groupLabel(v);
                label.querySelector("span").textContent = n === null ? "" : nf.format(n);
                frag.appendChild(label);
            });
            this._gListEl.appendChild(frag);
            this._gInfoEl.textContent = `${this._gValues.length} değer · ${this._gEdit.size} seçili`;
        }

        _initPopup() {
            const $ = (id) => this._root.getElementById(id);
            this._pop = $("pop");
            this._selRowsEl = $("selRows");
            this._searchEl = $("search");
            this._hitsEl = $("hits");
            this._hitInfoEl = $("hitInfo");
            stopEvents(this._pop);
            $("popClose").addEventListener("click", () => this._closePopup());
            $("popCancel").addEventListener("click", () => this._closePopup());
            $("popClear").addEventListener("click", () => { this._sel = []; this._renderSelRows(); this._renderHits(); });
            $("popOk").addEventListener("click", () => {
                this._readSelRows();
                this._closePopup();
                this._setFilter(this._sel.filter(s => s.low).map(tokenText).join("; "));
            });
            $("addRow").addEventListener("click", () => {
                this._readSelRows();
                this._sel.push({ low: "", high: "" });
                this._renderSelRows();
                const inputs = this._selRowsEl.querySelectorAll("input");
                if (inputs.length) inputs[inputs.length - 2].focus();
            });
            this._searchEl.addEventListener("input", () => {
                clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(() => this._search(), 300);
            });
            this._hitsEl.addEventListener("change", (e) => {
                const id = e.target.value;
                this._readSelRows();
                if (e.target.checked) {
                    if (!this._sel.some(s => !s.high && s.low === id)) this._sel.push({ low: id, high: "" });
                } else {
                    this._sel = this._sel.filter(s => s.high || s.low !== id);
                }
                this._renderSelRows();
            });
            this._pop.addEventListener("keydown", (e) => { if (e.key === "Escape") this._closePopup(); });
        }

        _openPopup() {
            this._gpop.hidden = true;
            this._kodInput.value = this._matFilter;
            this._sel = splitList(this._matFilter).map(parseToken);
            if (!this._sel.length) this._sel.push({ low: "", high: "" });
            this._renderSelRows();
            this._searchEl.value = "";
            this._pop.hidden = false;
            this._search();
            this._searchEl.focus();
        }

        _closePopup() {
            this._pop.hidden = true;
            this._searchToken = (this._searchToken || 0) + 1;
        }

        _readSelRows() {
            this._sel = Array.from(this._selRowsEl.querySelectorAll(".sel-row")).map(r => {
                const [lo, hi] = r.querySelectorAll("input");
                return { low: lo.value.trim(), high: hi.value.trim() };
            });
        }

        _renderSelRows() {
            this._selRowsEl.innerHTML = "";
            this._sel.forEach((s, i) => {
                const row = document.createElement("div");
                row.className = "sel-row";
                row.innerHTML = `<input type="text" placeholder="alt / 2*"> – <input type="text" placeholder="üst (ops.)"><button title="Sil">×</button>`;
                const [lo, hi] = row.querySelectorAll("input");
                lo.value = s.low;
                hi.value = s.high;
                row.querySelector("button").addEventListener("click", () => {
                    this._readSelRows();
                    this._sel.splice(i, 1);
                    this._renderSelRows();
                    this._renderHits();
                });
                this._selRowsEl.appendChild(row);
            });
        }

        async _search() {
            const token = this._searchToken = (this._searchToken || 0) + 1;
            const term = this._searchEl.value.trim();
            const all = this._allIds;
            let hits;
            let more = false;
            this._hitInfoEl.textContent = "aranıyor…";
            try {
                if (!term) {
                    hits = all.slice(0, MAX_HITS);
                    more = all.length > MAX_HITS;
                } else {
                    const m = /[*?]/.test(term) ? matcher(term) : (id => id.indexOf(term) >= 0);
                    const codeHits = all.filter(m);
                    const found = new Set(codeHits.slice(0, MAX_HITS));
                    if (found.size < MAX_HITS && !/^[\d*?\-]+$/.test(term)) {
                        const lower = term.toLocaleLowerCase("tr-TR");
                        const variants = Array.from(new Set([term, term.toLocaleUpperCase("tr-TR"), term.toUpperCase(), lower,
                            lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1)]));
                        const rows = await this._get("ZMALZEMEMaster", {
                            $select: "ID,Description",
                            $filter: variants.map(v => `contains(Description,'${q(v)}')`).join(" or "),
                            $top: 5000
                        });
                        if (token !== this._searchToken) return;
                        rows.forEach(r => {
                            this._desc.ZMALZEME.set(r.ID, r.Description || "");
                            if (this._allIndex.has(r.ID) && found.size < MAX_HITS) found.add(r.ID);
                        });
                    }
                    hits = Array.from(found).sort((a, b) => this._allIndex.get(a) - this._allIndex.get(b));
                    more = codeHits.length > MAX_HITS || hits.length >= MAX_HITS;
                }
                await this._loadDescriptions("ZMALZEME", hits);
                if (token !== this._searchToken) return;
                this._hits = hits;
                this._renderHits();
                this._hitInfoEl.textContent = hits.length
                    ? `${hits.length} malzeme${more ? ` (ilk ${MAX_HITS} gösteriliyor, aramayı daraltın)` : ""}`
                    : "Eşleşen malzeme yok.";
            } catch (e) {
                if (token === this._searchToken && !(e && e.name === "AbortError")) this._hitInfoEl.textContent = "Arama hatası: " + errText(e);
            }
        }

        _renderHits() {
            if (!this._hits) return;
            const singles = new Set((this._sel || []).filter(s => !s.high).map(s => s.low));
            this._hitsEl.innerHTML = "";
            const frag = document.createDocumentFragment();
            this._hits.forEach(id => {
                const label = document.createElement("label");
                label.innerHTML = `<input type="checkbox"><b></b><span></span>`;
                const cb = label.querySelector("input");
                cb.value = id;
                cb.checked = singles.has(id);
                label.querySelector("b").textContent = id;
                label.querySelector("span").textContent = this._desc.ZMALZEME.get(id) || "";
                frag.appendChild(label);
            });
            this._hitsEl.appendChild(frag);
        }

        _buildTable(dates, rows) {
            this._destroyTable();
            const columns = [
                { title: "Kod", field: "name", width: 260, frozen: true, titleFormatter: () => this._kodHeaderEl },
                { title: "Açıklama", field: "desc", width: 260, frozen: true, formatter: descFormatter },
                { title: "Grup 1", field: "g1", width: 120, cssClass: "soft", titleFormatter: () => this._gHeader[1].el },
                { title: "Grup 2", field: "g2", width: 170, cssClass: "soft", titleFormatter: () => this._gHeader[2].el },
                { title: "Tür", field: "type", width: 75, cssClass: "soft" }
            ];
            this._valueFields = [];
            dates.forEach(d => {
                columns.push({
                    title: fmtDate(d),
                    cssClass: "pgroup",
                    columns: this._params.map((p, i) => {
                        this._valueFields.push(fieldOf(d, p));
                        return {
                            title: this._paramDesc.get(p) || p, headerTooltip: p, headerWordWrap: true, field: fieldOf(d, p), width: 112,
                            hozAlign: "right", formatter: numFormatter, accessorClipboard: numCopy, cssClass: i === 0 ? "pstart" : ""
                        };
                    })
                });
            });

            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: [this._totalRow()].concat(rows),
                frozenRows: 1,
                height: "100%",
                rowHeight: 26,
                layout: "fitData",
                columns: columns,
                columnDefaults: { headerSort: false, resizable: "header", accessorClipboard: textCopy },
                selectableRange: 1,
                selectableRangeColumns: true,
                clipboard: "copy",
                clipboardCopyRowRange: "range",
                clipboardCopyStyled: false,
                clipboardCopyConfig: { columnHeaders: false, columnGroups: false, rowHeaders: false, columnCalcs: false, dataTree: false },
                dataTree: true,
                dataTreeStartExpanded: false,
                dataTreeChildIndent: 22,
                dataTreeElementColumn: "name",
                placeholder: "Filtreye uyan malzeme yok",
                rowFormatter: (row) => {
                    const k = row.getData()._kind;
                    if (k === "A") row.getElement().classList.add("row-activity");
                    if (k === "P") row.getElement().classList.add("row-placeholder");
                    if (k === "T") row.getElement().classList.add("row-total");
                }
            });
            this._table.on("tableBuilt", () => this._loadVisible());
            this._table.on("scrollVertical", () => {
                if (this._scrollTimer) return;
                this._scrollTimer = setTimeout(() => {
                    this._scrollTimer = null;
                    this._loadVisible();
                }, 100);
            });
            this._table.on("dataTreeRowExpanded", (row) => this._expand(row));
            this._table.on("rowMouseEnter", (e, row) => {
                clearTimeout(this._hoverTimer);
                this._hoverTimer = setTimeout(() => this._prefetch(row), 150);
            });
            this._table.on("rowMouseLeave", () => clearTimeout(this._hoverTimer));
            this._kodInput.classList.toggle("on", !!this._matFilter);
            this._updateTypeButton();
            this._updateStatus();
        }

        _loadVisible() {
            if (!this._table || !this._table.initialized || this._failed) return;
            const holder = this._tableEl.querySelector(".tabulator-tableholder");
            const rows = this._table.getRows("display");
            if (!holder || !rows.length) return;
            const pitch = holder.scrollHeight / rows.length || 26;
            const from = Math.max(0, Math.floor(holder.scrollTop / pitch));
            const to = Math.min(rows.length - 1, Math.ceil((holder.scrollTop + holder.clientHeight) / pitch));
            let min = Infinity, max = -Infinity;
            for (let i = from; i <= to; i++) {
                let r = rows[i];
                while (r && r.getData()._pos === undefined) r = r.getTreeParent();
                if (!r) continue;
                const p = r.getData()._pos;
                if (p < min) min = p;
                if (p > max) max = p;
            }
            if (min === Infinity) return;
            const first = Math.floor(min / this._blockSize);
            const last = Math.floor(max / this._blockSize);
            for (let b = Math.max(0, first - 1); b <= last + 1; b++) this._loadBlock(b);
        }

        async _fetchValues(ids) {
            const idx = this._allIndex;
            const contiguous = idx.get(ids[ids.length - 1]) - idx.get(ids[0]) === ids.length - 1;
            const parts = contiguous ? [ids] : chunks(ids, CHUNK);
            const results = await Promise.all(parts.map(part => this._get("FactDataAggregation", {
                $select: "ZMALZEME,Date,ZPARAMETRE,ZMIKTAR",
                $filter: this._baseFilter + (contiguous
                    ? ` and ZMALZEME ge '${q(part[0])}' and ZMALZEME le '${q(part[part.length - 1])}'`
                    : ` and ${orEq("ZMALZEME", part)}`)
            })));
            return [].concat.apply([], results);
        }

        async _loadBlock(b) {
            const start = b * this._blockSize;
            if (start >= this._ids.length || this._blocks.has(b)) return;
            const blocks = this._blocks;
            const ids = this._ids.slice(start, start + this._blockSize).filter(id => !this._valCache.has(id));
            if (!ids.length) {
                blocks.set(b, "done");
                return;
            }
            blocks.set(b, "busy");
            this._updateStatus();
            const token = this._token;
            try {
                const bulk = this._matVals;
                const [vals] = await Promise.all([bulk ? null : this._fetchValues(ids), this._loadDescriptions("ZMALZEME", ids)]);
                if (token !== this._token) return;
                const empty = Object.fromEntries(this._valueFields.map(f => [f, null]));
                const updates = new Map(ids.map(id => [id, Object.assign({ key: `M${id}`, desc: this._desc.ZMALZEME.get(id) || "" }, empty, this._attrOf("ZMALZEME", id))]));
                if (vals) vals.forEach(r => { if (updates.has(r.ZMALZEME)) addValue(updates.get(r.ZMALZEME), r); });
                else updates.forEach((u, id) => Object.assign(u, bulk.get(id) || {}));
                updates.forEach((u, id) => this._valCache.set(id, u));
                const visible = Array.from(updates.values()).filter(u => this._table.getRow(u.key));
                if (visible.length) await this._table.updateData(visible);
                if (blocks === this._blocks) blocks.set(b, "done");
                this._updateStatus();
            } catch (e) {
                if (token !== this._token) return;
                blocks.delete(b);
                this._failed = true;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        async _expand(row) {
            const d = row.getData();
            if (d._kind === "P" || d._loaded || d._busy) return;
            d._busy = true;
            const token = this._token;
            try {
                const { comps, acts } = await this._childData(d._id);
                if (token !== this._token) return;
                const compIds = Array.from(comps.keys()).sort();
                const actIds = Array.from(acts.keys()).sort();
                const children = [];
                compIds.forEach(id => children.push(Object.assign(this._row(`${d.key}/B${id}`, "B", id, "ZBILESEN", this._parentSet.has(id)), comps.get(id))));
                actIds.forEach(id => children.push(Object.assign(this._row(`${d.key}/A${id}`, "A", id, "ZMASRAF_OGESI", false), acts.get(id))));
                await row.update({ _children: children.length ? children : null, _loaded: true, _busy: false });

                await Promise.all([
                    this._loadDescriptions("ZBILESEN", compIds),
                    this._loadDescriptions("ZMASRAF_OGESI", actIds)
                ]);
                if (token !== this._token) return;
                row.getTreeChildren().forEach(c => {
                    const cd = c.getData();
                    const dim = cd._kind === "B" ? "ZBILESEN" : cd._kind === "A" ? "ZMASRAF_OGESI" : null;
                    const desc = dim ? this._desc[dim].get(cd._id) || "" : "";
                    if (dim === "ZBILESEN") {
                        const a = this._attrOf(dim, cd._id);
                        if (desc !== cd.desc || a.g1 !== cd.g1 || a.g2 !== cd.g2) c.update({ desc, g1: a.g1, g2: a.g2 });
                    } else if (dim && desc !== cd.desc) {
                        c.update({ desc });
                    }
                });
            } catch (e) {
                d._busy = false;
                if (token !== this._token) return;
                await row.update({ _children: [{ key: d.key + "/!", name: "Hata: " + errText(e), _kind: "P" }] });
            }
        }
    }

    customElements.define("custom-usm-tree", UsmTree);
})();
