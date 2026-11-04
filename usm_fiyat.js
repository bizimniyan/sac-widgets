(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js";
    const FFLATE_JS = "https://unpkg.com/fflate@0.8.2/esm/browser.js";
    const NONE = "#";
    const NO_DATE = "000000";
    const MAX_HITS = 200;
    const DEFAULT_MEASURES = ["ZORAN", "ZFIYAT"];
    const DATES_KEY = "usmFiyatDates:";
    const BLOCK = 200;
    const ROW_H = 26;
    const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const XLSX_HEAD = ["Malzeme", "Açıklama", "Grup 1", "Grup 2", "Tedarikçi", "Tedarikçi Adı", "Para Birimi"];

    const loadScript = (src) => new Promise((resolve, reject) => {
        if (window.Tabulator) return resolve();
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Tabulator yüklenemedi"));
        document.head.appendChild(script);
    });

    const SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
    const OR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const XLSX_STATIC = {
        "[Content_Types].xml": XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        "_rels/.rels": XML + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${OR}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "xl/workbook.xml": XML + `<workbook xmlns="${SS}" xmlns:r="${OR}"><sheets><sheet name="Fiyat" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": XML + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${OR}/worksheet" Target="worksheets/sheet1.xml"/>` +
            `<Relationship Id="rId2" Type="${OR}/styles" Target="styles.xml"/></Relationships>`,
        "xl/styles.xml": XML + `<styleSheet xmlns="${SS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    };
    const xmlEsc = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/[&<>]/g, c => c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;");
    const colName = (i) => {
        let s = "";
        for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
    };
    const xlsxFile = (fflate, cols) => {
        const out = [];
        const zip = new fflate.Zip((err, data) => { if (err) throw err; out.push(data); });
        Object.keys(XLSX_STATIC).forEach(name => {
            const f = new fflate.ZipDeflate(name, { level: 1 });
            zip.add(f);
            f.push(fflate.strToU8(XLSX_STATIC[name]), true);
        });
        const sheet = new fflate.ZipDeflate("xl/worksheets/sheet1.xml", { level: 1 });
        zip.add(sheet);
        let n = 0;
        let buf = [XML + `<worksheet xmlns="${SS}"><sheetData>`];
        const flush = (final) => { sheet.push(fflate.strToU8(buf.join("")), final); buf = []; };
        const row = (cells, style) => {
            n++;
            let s = `<row r="${n}">`;
            cells.forEach((v, i) => {
                if (v === null || v === undefined || v === "") return;
                s += typeof v === "number"
                    ? `<c r="${cols[i]}${n}"${style}><v>${v}</v></c>`
                    : `<c r="${cols[i]}${n}" t="inlineStr"${style}><is><t>${xmlEsc(v)}</t></is></c>`;
            });
            buf.push(s + "</row>");
            if (buf.length >= 2000) flush(false);
        };
        return {
            head: (cells) => row(cells, ' s="1"'),
            add: (cells) => row(cells, ""),
            finish: () => { buf.push("</sheetData></worksheet>"); flush(true); zip.end(); return out; }
        };
    };
    const download = (blob, name) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    };
    const tick = () => new Promise(r => setTimeout(r, 0));

    const q = (v) => String(v).replace(/'/g, "''");
    const orEq = (field, ids) => "(" + ids.map(id => `${field} eq '${q(id)}'`).join(" or ") + ")";
    const splitList = (text) => String(text || "").split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
    const memberId = (v) => {
        const m = String(v || "").trim().match(/&\[([^\]]*)\]$/);
        return m ? m[1] : String(v || "").trim();
    };
    const fieldOf = (param, date) => `v${param}_${date}`;
    const fmtDate = (d) => d === NO_DATE ? "Dönemsiz" : /^\d{6}$/.test(d) ? `${d.slice(4)}.${d.slice(0, 4)}` : d;
    const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
    const nfCopy = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6, useGrouping: false });
    const numCopy = (v) => v === undefined || v === null ? "" : nfCopy.format(v);
    const textCopy = (v) => v === undefined || v === null ? "" : v;
    const numFormatter = (cell) => {
        const v = cell.getValue();
        const empty = v === undefined || v === null;
        const el = cell.getElement();
        if (el.classList.contains("dash") !== empty) el.classList.toggle("dash", empty);
        if (!empty) return nf.format(v);
        const d = cell.getData();
        return d._total || d._wait ? "" : "–";
    };
    const errText = (e) => e && e.message ? e.message : String(e);
    const nonZero = (v) => Math.abs(v) >= 1e-9;

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
    const groupLabel = (v) => v ? v : "(boş)";
    const stopEvents = (el) => ["mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "contextmenu"]
        .forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));
    const readCache = (key) => {
        try { return JSON.parse(window.localStorage.getItem(DATES_KEY + key) || "null"); } catch (e) { return null; }
    };
    const writeCache = (key, val) => {
        try { window.localStorage.setItem(DATES_KEY + key, JSON.stringify(val)); } catch (e) { return; }
    };
    const chunks = (arr, n) => {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    };

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; }
            .bar { flex: 0 0 auto; display: flex; align-items: center; }
            #status { flex: 1 1 auto; font-size: 11px; color: #9a9a9a; padding: 4px 6px; }
            #xls { flex: 0 0 auto; margin: 2px 6px; padding: 1px 8px; font: 11px Arial, sans-serif; cursor: pointer; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; }
            #xls:hover:not(:disabled) { background: #ffe8e8; }
            #xls:disabled { color: #999; cursor: default; }
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
            .tabulator-row { color: #3a3a3a; }
            .tabulator .tabulator-tableholder .tabulator-range-overlay .tabulator-range,
            .tabulator .tabulator-tableholder .tabulator-range-overlay .tabulator-range-cell-active { border-color: #ff0000 !important; }
            .tabulator .tabulator-tableholder .tabulator-range-overlay .tabulator-range.tabulator-range-active::after { background-color: #ff0000 !important; }
            .pop input[type=checkbox] { accent-color: #ff0000; }
            .kod-f input:focus, .pop input[type=text]:focus { outline: 1px solid #ff0000; outline-offset: 0; border-color: #ff0000; }
            .tabulator-row .tabulator-cell.tabulator-range-selected:not(.tabulator-range-only-cell-selected) { background-color: #ffd9d9 !important; }
            .tabulator .tabulator-header .tabulator-col.tabulator-range-highlight, .tabulator .tabulator-header .tabulator-col.tabulator-range-selected { background: #ffecec !important; color: inherit !important; }
            .tabulator-row .tabulator-cell.dash { color: #cfcfcf; font-weight: 400; }
            .kod-f { display: flex; gap: 3px; margin-top: 6px; }
            .kod-f input { flex: 1 1 auto; min-width: 0; font: 11px Arial, sans-serif; padding: 2px 4px; border: 1px solid #dadada; border-radius: 3px; color: #333; }
            .kod-f input.on { border-color: #ff0000; background: #ffe8e8; }
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
            #search, #gSearch { font: 12px Arial, sans-serif; padding: 3px 5px; border: 1px solid #c4c4c4; border-radius: 3px; }
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
            .kod-f .gbtn.on { border-color: #ff0000 !important; background: #ffe8e8 !important; }
            .gpop { width: 300px; }
            .gpop .hits b { flex: 1 1 auto; font-weight: normal; overflow: hidden; text-overflow: ellipsis; }
            .gpop .hits span { flex: 0 0 auto; color: #888; }
        </style>
        <div class="wrap">
            <div class="bar"><button id="xls">Excel'e aktar</button><div id="status">Yükleniyor…</div></div>
            <div id="table"></div>
            <div id="pop" class="pop" hidden>
                <div class="pop-h"><span id="popTitle">Malzeme seçimi</span><button class="x" id="popClose" title="Kapat">×</button></div>
                <div class="pop-b">
                    <div class="pop-sec">Seçimler <small>(tek kod, 11* veya alt – üst aralık)</small></div>
                    <div id="selRows" class="sel-rows"></div>
                    <button id="addRow" class="link">+ satır</button>
                    <div class="pop-sec"><span id="popSearchLbl">Malzeme ara</span> <small>(kod veya tanım; işaretle = seçimlere ekle)</small></div>
                    <input id="search" type="text" placeholder="örn. 1100253 veya RULMAN">
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

    class UsmFiyat extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._root = shadowRoot;
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._xlsBtn = shadowRoot.getElementById("xls");
            this._xlsBtn.addEventListener("click", () => this.exportExcel());
            this._table = null;
            this._token = 0;
            this._matFilter = "";
            this._supFilter = "";
            this._supIds = [];
            this._supDesc = new Map();
            this._rows = [];
            this._shown = [];
            this._allIds = [];
            this._allIndex = new Map();
            this._matDesc = new Map();
            this._matAttr = new Map();
            this._supVals = new Map();
            this._grp = { 1: null, 2: null, cur: null };
            this._gHeader = {};
            this._kodHeaderEl = this._buildFilterHeader("mat");
            this._supHeaderEl = this._buildFilterHeader("sup");
            this._buildGroupHeader(1, "Grup 1");
            this._buildGroupHeader(2, "Grup 2");
            this._buildGroupHeader("cur", "Para Birimi");
            this._initPopup();
            this._initGroupPopup();
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if ("materialFilter" in changedProperties) {
                this._matFilter = splitList(this.materialFilter).join("; ");
                this._kodInput.value = this._matFilter;
            }
            if ("supplierFilter" in changedProperties) {
                this._supFilter = splitList(this.supplierFilter).join("; ");
                this._supInput.value = this._supFilter;
            }
            if ("currencyFilter" in changedProperties) this._setGroup("cur", this.currencyFilter || "");
            if (["providerId", "version", "companyCode", "parameters", "measures"].some(k => k in changedProperties)) {
                this._scheduleReload();
            } else if ("materialFilter" in changedProperties || "supplierFilter" in changedProperties) {
                this._applyFilter();
            }
        }

        onCustomWidgetResize() {
            if (this._table) this._table.redraw();
        }

        setMaterialFilter(filter) {
            this._setKindFilter("mat", filter);
        }

        getMaterialFilter() {
            return this._matFilter;
        }

        setSupplierFilter(filter) {
            this._setKindFilter("sup", filter);
        }

        getSupplierFilter() {
            return this._supFilter;
        }

        _setKindFilter(kind, text) {
            const v = splitList(text).join("; ");
            if (kind === "sup") {
                this._supFilter = v;
                this._supInput.value = v;
            } else {
                this._matFilter = v;
                this._kodInput.value = v;
            }
            this._applyFilter();
        }

        setGroup1Filter(values) {
            this._setGroup(1, values);
        }

        setGroup2Filter(values) {
            this._setGroup(2, values);
        }

        setCurrencyFilter(values) {
            this._setGroup("cur", values);
        }

        getCurrencyFilter() {
            return this._grp.cur ? Array.from(this._grp.cur).join(";") : "";
        }

        refresh() {
            return this._reload(true);
        }

        _setGroup(level, values) {
            const list = values instanceof Set ? Array.from(values)
                : typeof values === "string" ? (level === "cur" ? splitList(values).map(v => v.toUpperCase())
                    : values.trim() ? values.split(";").map(s => s.trim()) : null)
                : Array.isArray(values) ? values : null;
            this._grp[level] = list && list.length ? new Set(list.map(v => v === "(boş)" ? "" : v)) : null;
            const g = this._grp[level];
            const btn = this._gHeader[level].btn;
            btn.textContent = !g ? "Tümü ▾" : g.size === 1 ? groupLabel(Array.from(g)[0]) + " ▾" : `${g.size} seçili ▾`;
            btn.classList.toggle("on", !!g);
            this._applyFilter();
        }

        _scheduleReload() {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => this._reload(false), 150);
        }

        _loadParams() {
            let version = memberId(this.version);
            if (version && version.indexOf(".") < 0) version = "public." + version;
            const companies = splitList(this.companyCode).map(memberId).filter(Boolean).sort();
            const params = splitList(this.parameters);
            const measures = splitList(this.measures).length ? splitList(this.measures) : DEFAULT_MEASURES;
            const pid = (this.providerId || "").trim();
            const sig = JSON.stringify([pid, version, companies, params, measures]);
            return { pid, version, companies, params, measures, sig };
        }

        _reload(force) {
            const p = this._loadParams();
            if (!force && p.sig === this._loadSig) return false;
            this._loadSig = p.sig;
            this._doReload(p);
            return true;
        }

        async _doReload(p) {
            if (this._abort) this._abort.abort();
            this._abort = new AbortController();
            const token = ++this._token;
            this._pid = p.pid;
            this._params = p.params;
            this._measures = p.measures;
            this._full = false;
            this._bulkPromise = null;
            this._blocks = new Map();
            this._matState = new Map();
            if (!p.pid || !p.version || !p.params.length) {
                this._setStatus("Builder panelinden model, versiyon ve parametreleri girin.");
                return;
            }
            const scope = `Version eq '${q(p.version)}'` + (p.companies.length ? ` and ${orEq("ZSIRKET_KODU", p.companies)}` : "");
            const paramFilter = `${scope} and ${orEq("ZPARAMETRE", p.params)} and Date ne '${NONE}'`;
            this._paramFilter = paramFilter;
            const ms = p.measures.join(",");
            const t0 = Date.now();
            this._setStatus("Satırlar yükleniyor…");
            const cached = readCache(p.sig);
            let bulk = cached ? this._fetchBulk(cached) : null;
            if (bulk) bulk.catch(() => {});

            try {
                const [, rowRecs, colRecs, supRecs, paramRows, supRows] = await Promise.all([
                    loadScript(TABULATOR_JS),
                    this._get("FactDataAggregation", { $select: `ZMALZEME,ZTEDARIKCI,ZCURRENCY,${ms}`, $filter: `${paramFilter} and ZMALZEME ne '${NONE}'` }),
                    this._get("FactDataAggregation", { $select: `ZPARAMETRE,Date,${ms}`, $filter: `${paramFilter} and (ZMALZEME ne '${NONE}' or ZTEDARIKCI ne '${NONE}')` }),
                    this._get("FactDataAggregation", { $select: `ZTEDARIKCI,ZPARAMETRE,Date,${ms}`, $filter: `${paramFilter} and ZMALZEME eq '${NONE}' and ZTEDARIKCI ne '${NONE}'` }),
                    this._get("ZPARAMETREMaster", { $select: "ID,Description", $filter: orEq("ID", p.params) }).catch(() => []),
                    this._get("ZTEDARIKCIMaster", { $select: "ID,Description" }).catch(() => [])
                ]);
                if (token !== this._token) return;
                this._paramDesc = new Map(paramRows.filter(r => r.Description).map(r => [r.ID, r.Description]));
                this._supDesc = new Map(supRows.map(r => [r.ID, r.Description || ""]));
                const paramDates = new Map(this._params.map(pr => [pr, new Set()]));
                colRecs.forEach(r => { if (this._valOf(r) !== null && paramDates.has(r.ZPARAMETRE)) paramDates.get(r.ZPARAMETRE).add(r.Date); });
                this._supVals = new Map();
                supRecs.forEach(r => {
                    const v = this._valOf(r);
                    if (v === null) return;
                    let s = this._supVals.get(r.ZTEDARIKCI);
                    if (!s) this._supVals.set(r.ZTEDARIKCI, s = {});
                    const f = fieldOf(r.ZPARAMETRE, r.Date);
                    s[f] = (s[f] || 0) + v;
                });
                const byKey = new Map();
                rowRecs.forEach(r => {
                    if (this._valOf(r) === null) return;
                    const key = `${r.ZMALZEME}|${r.ZTEDARIKCI}|${r.ZCURRENCY}`;
                    if (byKey.has(key)) return;
                    const sup = r.ZTEDARIKCI === NONE ? "" : r.ZTEDARIKCI;
                    byKey.set(key, {
                        key, mat: r.ZMALZEME, sup, cur: r.ZCURRENCY === NONE ? "" : r.ZCURRENCY,
                        desc: this._matDesc.has(r.ZMALZEME) ? this._matDesc.get(r.ZMALZEME) : null,
                        g1: "", g2: "", supName: sup ? this._supDesc.get(sup) || "" : "", _wait: true
                    });
                });
                const rows = Array.from(byKey.values());
                rows.forEach(row => { const a = this._matAttr.get(row.mat); if (a) { row.g1 = a.g1; row.g2 = a.g2; } });
                rows.sort((a, b) => cmpCode(a.mat, b.mat) || cmpCode(a.sup, b.sup) || (a.cur < b.cur ? -1 : a.cur > b.cur ? 1 : 0));
                this._byKey = byKey;
                this._rows = rows;
                this._allIds = Array.from(new Set(rows.map(r => r.mat)));
                this._allIndex = new Map(this._allIds.map((id, i) => [id, i]));
                this._supIds = Array.from(new Set(rows.map(r => r.sup).filter(Boolean))).sort(cmpCode);
                this._valueCols = [];
                this._params.forEach(pr => {
                    const ds = Array.from(paramDates.get(pr)).sort();
                    const title = this._paramDesc.get(pr) || pr;
                    if (!ds.length) ds.push(NO_DATE);
                    ds.forEach(d => this._valueCols.push({ param: pr, date: d, field: fieldOf(pr, d), title, single: ds.length === 1 }));
                });
                if (!rows.length) {
                    this._destroyTable();
                    this._setStatus(`${p.version}${p.companies.length ? " / " + p.companies.join(",") : ""} için bu parametrelerle malzeme verisi yok.`);
                    return;
                }
                this._buildTable();
                this._loadMs = Date.now() - t0;
                this._updateStatus();
                const dates = Array.from(new Set(colRecs.map(r => r.Date))).sort();
                if (!cached || cached.join() !== dates.join()) {
                    writeCache(p.sig, dates);
                    bulk = this._fetchBulk(dates);
                }
                this._bulkPromise = this._loadBulk(bulk, token, t0);
                this._bulkPromise.catch(() => {});
                this._loadMasters(token);
            } catch (e) {
                if (token !== this._token || (e && e.name === "AbortError")) return;
                this._loadSig = null;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        _valOf(r) {
            const measures = this._measures;
            for (let k = 0; k < measures.length; k++) {
                const x = r[measures[k]];
                if (x !== null && x !== undefined) return x;
            }
            return null;
        }

        _fill(rows, recs) {
            const vals = new Map(rows.map(row => [row.key, {}]));
            recs.forEach(r => {
                const t = vals.get(`${r.ZMALZEME}|${r.ZTEDARIKCI}|${r.ZCURRENCY}`);
                if (!t) return;
                const v = this._valOf(r);
                if (v === null) return;
                const f = fieldOf(r.ZPARAMETRE, r.Date);
                t[f] = (t[f] || 0) + v;
            });
            const fields = this._valueCols.map(c => c.field);
            return rows.map(row => {
                const t = vals.get(row.key);
                const s = row.sup && this._supVals.get(row.sup);
                const upd = { key: row.key, _wait: false };
                fields.forEach(f => { upd[f] = s && s[f] !== undefined ? s[f] : t[f] !== undefined ? t[f] : null; });
                Object.assign(row, upd);
                return upd;
            });
        }

        _fetchBulk(dates) {
            const sel = `ZMALZEME,ZTEDARIKCI,ZCURRENCY,ZPARAMETRE,Date,${this._measures.join(",")}`;
            return Promise.all(dates.map(d => this._get("FactDataAggregation", {
                $select: sel, $filter: `${this._paramFilter} and ZMALZEME ne '${NONE}' and Date eq '${q(d)}'`
            }))).then(sets => [].concat(...sets));
        }

        async _loadBulk(bulk, token, t0) {
            const recs = await bulk;
            if (token !== this._token) return;
            this._fill(this._rows, recs);
            this._full = true;
            this._loadMs = Date.now() - t0;
            this._dropZeros();
            if (!this._rows.length) {
                this._destroyTable();
                this._setStatus("Bu seçimde tüm değerler 0.");
                return;
            }
            this._applyFilter();
        }

        _dropZeros() {
            const cols = this._valueCols;
            const live = new Set();
            this._rows = this._rows.filter(r => {
                let any = false;
                for (let i = 0; i < cols.length; i++) {
                    if (nonZero(r[cols[i].field])) { any = true; live.add(cols[i].field); }
                }
                return any;
            });
            this._allIds = Array.from(new Set(this._rows.map(r => r.mat)));
            this._allIndex = new Map(this._allIds.map((id, i) => [id, i]));
            this._supIds = Array.from(new Set(this._rows.map(r => r.sup).filter(Boolean))).sort(cmpCode);
            if (live.size === cols.length) return;
            this._valueCols = cols.filter(c => live.has(c.field));
            if (this._table && this._valueCols.length) this._table.setColumns(this._columns());
        }

        async _loadMasters(token) {
            const ids = this._allIds.slice().sort(cmpCode);
            const want = new Set(ids);
            const gap = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) && a.length === b.length ? Number(b) - Number(a) : Infinity;
            const cuts = ids.slice(1).map((id, i) => [gap(ids[i], id), i + 1]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(c => c[1]).sort((a, b) => a - b);
            const segs = [];
            [0].concat(cuts).forEach((s, i, arr) => { const e = i + 1 < arr.length ? arr[i + 1] : ids.length; if (e > s) segs.push(ids.slice(s, e)); });
            try {
                await Promise.all(segs.map(async seg => {
                    const rows = await this._get("ZMALZEMEMaster", {
                        $select: "ID,Description,MALZ_GRUP1,MALZ_GRUP2",
                        $filter: seg.length === 1 ? `ID eq '${q(seg[0])}'` : `ID ge '${q(seg[0])}' and ID le '${q(seg[seg.length - 1])}'`
                    });
                    rows.forEach(r => {
                        if (!want.has(r.ID)) return;
                        this._matDesc.set(r.ID, r.Description || "");
                        this._matAttr.set(r.ID, { g1: r.MALZ_GRUP1 || "", g2: r.MALZ_GRUP2 || "" });
                    });
                }));
            } catch (e) {
                if (e && e.name === "AbortError") return;
            }
            if (token !== this._token) return;
            this._rows.forEach(row => {
                const a = this._matAttr.get(row.mat);
                row.desc = this._matDesc.get(row.mat) || "";
                row.g1 = a ? a.g1 : "";
                row.g2 = a ? a.g2 : "";
            });
            this._applyFilter();
        }

        _loadVisible() {
            if (!this._table || this._full) return;
            const holder = this._tableEl.querySelector(".tabulator-tableholder");
            const shown = this._shown;
            if (!holder || !shown.length) return;
            const from = Math.max(0, Math.floor(holder.scrollTop / ROW_H) - 1);
            const to = Math.min(shown.length - 1, Math.ceil((holder.scrollTop + holder.clientHeight) / ROW_H));
            for (let b = Math.max(0, Math.floor(from / BLOCK) - 1); b <= Math.floor(to / BLOCK) + 1; b++) this._loadBlock(b);
        }

        async _loadBlock(b) {
            const shown = this._shown;
            const start = b * BLOCK;
            if (start >= shown.length || this._blocks.get(b) === shown) return;
            this._blocks.set(b, shown);
            const mats = Array.from(new Set(shown.slice(start, start + BLOCK).map(r => r.mat))).filter(m => !this._matState.has(m)).sort(cmpCode);
            if (!mats.length) return;
            mats.forEach(m => this._matState.set(m, "busy"));
            const token = this._token;
            const same = mats.every(m => /^\d+$/.test(m) && m.length === mats[0].length);
            const lo = mats[0], hi = mats[mats.length - 1];
            const sel = `ZMALZEME,ZTEDARIKCI,ZCURRENCY,ZPARAMETRE,Date,${this._measures.join(",")}`;
            try {
                const parts = same ? [`ZMALZEME ge '${q(lo)}' and ZMALZEME le '${q(hi)}'`] : chunks(mats, 40).map(c => orEq("ZMALZEME", c));
                const recs = [].concat(...await Promise.all(parts.map(f => this._get("FactDataAggregation", { $select: sel, $filter: `${this._paramFilter} and ${f}` }))));
                if (token !== this._token || this._full) return;
                const inRange = same
                    ? (m) => /^\d+$/.test(m) && m.length === lo.length && m >= lo && m <= hi && this._matState.get(m) !== "done"
                    : (m) => mats.indexOf(m) >= 0;
                const rows = this._rows.filter(r => inRange(r.mat));
                rows.forEach(r => this._matState.set(r.mat, "done"));
                const upd = this._fill(rows, recs).filter(u => this._table.getRow(u.key));
                if (upd.length) await this._table.updateData(upd);
            } catch (e) {
                mats.forEach(m => { if (this._matState.get(m) === "busy") this._matState.delete(m); });
                this._blocks.delete(b);
                if (token === this._token && !(e && e.name === "AbortError")) this._setStatus("Değerler alınamadı: " + errText(e), true);
            }
        }

        _filtered() {
            const m = matcher(this._matFilter);
            const sm = matcher(this._supFilter);
            const g1 = this._grp[1];
            const g2 = this._grp[2];
            const gc = this._grp.cur;
            if (!m && !sm && !g1 && !g2 && !gc) return this._rows;
            return this._rows.filter(r => (!m || m(r.mat)) && (!sm || sm(r.sup)) && (!g1 || g1.has(r.g1)) && (!g2 || g2.has(r.g2)) && (!gc || gc.has(r.cur)));
        }

        _totalRow() {
            const shown = this._shown;
            const row = { key: "TOTAL", mat: "Toplam", desc: this._full ? `${nf.format(shown.length)} satır` : "hesaplanıyor…", g1: "", g2: "", sup: "", supName: "", cur: "", _total: true };
            const fields = this._valueCols.map(c => c.field);
            fields.forEach(f => { row[f] = null; });
            if (!this._full) return row;
            shown.forEach(r => {
                for (let i = 0; i < fields.length; i++) {
                    const v = r[fields[i]];
                    if (v !== undefined) row[fields[i]] = (row[fields[i]] || 0) + v;
                }
            });
            return row;
        }

        _applyFilter() {
            this._kodInput.classList.toggle("on", !!this._matFilter);
            this._supInput.classList.toggle("on", !!this._supFilter);
            if (!this._table) return;
            this._shown = this._filtered();
            this._table.replaceData([this._totalRow()].concat(this._shown)).then(() => this._loadVisible());
            this._updateStatus();
        }

        _columns() {
            const columns = [
                { title: "Malzeme", field: "mat", width: 190, frozen: true, titleFormatter: () => this._kodHeaderEl },
                { title: "Açıklama", field: "desc", width: 260, frozen: true },
                { title: "Grup 1", field: "g1", width: 120, cssClass: "soft", titleFormatter: () => this._gHeader[1].el },
                { title: "Grup 2", field: "g2", width: 160, cssClass: "soft", titleFormatter: () => this._gHeader[2].el },
                { title: "Tedarikçi", field: "sup", width: 160, titleFormatter: () => this._supHeaderEl },
                { title: "Tedarikçi Adı", field: "supName", width: 220, cssClass: "soft" },
                { title: "Para Birimi", field: "cur", width: 100, titleFormatter: () => this._gHeader.cur.el }
            ];
            const valueCol = (c, title, first) => ({
                title, headerTooltip: `${c.param} ${fmtDate(c.date)}`, headerWordWrap: true, field: c.field, width: 105,
                hozAlign: "right", formatter: numFormatter, accessorClipboard: numCopy, cssClass: first ? "pstart" : ""
            });
            this._params.forEach(pr => {
                const cols = this._valueCols.filter(c => c.param === pr);
                if (!cols.length) return;
                if (cols[0].single) {
                    columns.push(valueCol(cols[0], cols[0].title, true));
                } else {
                    columns.push({ title: cols[0].title, cssClass: "pgroup", columns: cols.map((c, i) => valueCol(c, fmtDate(c.date), i === 0)) });
                }
            });
            return columns;
        }

        _buildTable() {
            this._destroyTable();
            this._shown = this._filtered();
            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: [this._totalRow()].concat(this._shown),
                frozenRows: 1,
                height: "100%",
                rowHeight: 26,
                layout: "fitData",
                columns: this._columns(),
                columnDefaults: { headerSort: false, resizable: "header", accessorClipboard: textCopy },
                selectableRange: 1,
                selectableRangeColumns: true,
                clipboard: "copy",
                clipboardCopyRowRange: "range",
                clipboardCopyStyled: false,
                clipboardCopyConfig: { columnHeaders: false, columnGroups: false, rowHeaders: false, columnCalcs: false },
                placeholder: "Filtreye uyan satır yok",
                rowFormatter: (row) => { if (row.getData()._total) row.getElement().classList.add("row-total"); }
            });
            this._table.on("tableBuilt", () => this._loadVisible());
            this._table.on("scrollVertical", () => {
                if (this._scrollTimer) return;
                this._scrollTimer = setTimeout(() => { this._scrollTimer = null; this._loadVisible(); }, 100);
            });
            this._kodInput.classList.toggle("on", !!this._matFilter);
            this._supInput.classList.toggle("on", !!this._supFilter);
        }

        async exportExcel() {
            if (this._exporting) return;
            if (!this._table || !this._shown.length) {
                this._setStatus("Aktarılacak veri yok.");
                return;
            }
            this._exporting = true;
            const btn = this._xlsBtn;
            btn.disabled = true;
            btn.textContent = "Excel: veri yükleniyor…";
            try {
                const fflate = await import(FFLATE_JS);
                if (!this._full && this._bulkPromise) await this._bulkPromise;
                if (!this._full) throw new Error("değerler henüz yüklenmedi");
                btn.textContent = "Excel hazırlanıyor…";
                await tick();
                const vc = this._valueCols;
                const head = XLSX_HEAD.concat(vc.map(c => c.single ? c.title : `${c.title} ${fmtDate(c.date)}`));
                const file = xlsxFile(fflate, head.map((_, i) => colName(i)));
                file.head(head);
                const rows = this._shown;
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    const cells = [r.mat, r.desc, r.g1, r.g2, r.sup, r.supName, r.cur];
                    for (let k = 0; k < vc.length; k++) {
                        const v = r[vc[k].field];
                        cells.push(v !== undefined && v !== null ? Math.round(v * 1e6) / 1e6 : null);
                    }
                    file.add(cells);
                }
                const name = `USM_Fiyat_${this._loadParams().version.replace(/^public\./, "")}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
                download(new Blob(file.finish(), { type: XLSX_MIME }), name);
                this._setStatus(`Excel: ${nf.format(rows.length)} satır indirildi.`);
            } catch (e) {
                this._setStatus("Excel aktarılamadı: " + errText(e), true);
            } finally {
                this._exporting = false;
                btn.disabled = false;
                btn.textContent = "Excel'e aktar";
            }
        }

        _setStatus(text, isError) {
            this._statusEl.textContent = text;
            this._statusEl.className = isError ? "error" : "";
        }

        _updateStatus() {
            const n = this._shown.length;
            const all = this._rows.length;
            const secs = this._loadMs ? ` · ${(this._loadMs / 1000).toFixed(1)} sn` : "";
            this._setStatus(`${n === all ? nf.format(all) : `${nf.format(n)} / ${nf.format(all)}`} satır${this._full ? secs : " · değerler yükleniyor…"}`);
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
            let retries = 2;
            while (url) {
                const resp = await fetch(url, { method: "GET", credentials: "include", headers: { Accept: "application/json" }, signal: this._abort && this._abort.signal });
                if (resp.status >= 500 && retries-- > 0) {
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
                if (!resp.ok) {
                    const body = await resp.text();
                    throw new Error(`HTTP ${resp.status} ${body.slice(0, 300)}`);
                }
                const data = await resp.json();
                const rows = Array.isArray(data) ? data : (data.value || []);
                for (let i = 0; i < rows.length; i++) out.push(rows[i]);
                url = Array.isArray(data) ? null : (data["@odata.nextLink"] || null);
            }
            return out;
        }

        _buildFilterHeader(kind) {
            const sup = kind === "sup";
            const el = document.createElement("div");
            el.innerHTML = `<div>${sup ? "Tedarikçi" : "Malzeme"}</div><div class="kod-f"><input type="text" placeholder="${sup ? "200220, 2002*" : "11*, 11000001-11000999"}"><button title="Çoklu seçim">⋯</button></div>`;
            const box = el.querySelector(".kod-f");
            const input = box.querySelector("input");
            const current = () => sup ? this._supFilter : this._matFilter;
            if (sup) this._supInput = input;
            else this._kodInput = input;
            stopEvents(box);
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") this._setKindFilter(kind, input.value);
                if (e.key === "Escape") { input.value = current(); input.blur(); }
            });
            input.addEventListener("change", () => this._setKindFilter(kind, input.value));
            box.querySelector("button").addEventListener("click", () => this._openPopup(kind));
            return el;
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

        _openGroupPopup(level, btn) {
            this._pop.hidden = true;
            this._gLevel = level;
            this._root.getElementById("gTitle").textContent = this._gHeader[level].title + " seçimi";
            const wrap = this._root.querySelector(".wrap").getBoundingClientRect();
            const r = btn.getBoundingClientRect();
            this._gpop.style.left = Math.max(8, Math.min(r.left - wrap.left, wrap.width - 308)) + "px";
            this._gSearchEl.value = "";
            const key = level === 1 ? "g1" : level === 2 ? "g2" : "cur";
            const counts = new Map();
            this._rows.forEach(row => counts.set(row[key], (counts.get(row[key]) || 0) + 1));
            this._gValues = Array.from(counts.entries()).sort((a, b) => a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0], "tr"));
            const cur = this._grp[level];
            this._gEdit = new Set(cur ? Array.from(cur) : this._gValues.map(v => v[0]));
            this._gpop.hidden = false;
            this._renderGroupList();
            this._gSearchEl.focus();
        }

        _renderGroupList() {
            const term = this._gSearchEl.value.trim().toLocaleLowerCase("tr-TR");
            const shown = this._gValues.filter(v => !term || groupLabel(v[0]).toLocaleLowerCase("tr-TR").indexOf(term) >= 0);
            this._gListEl.innerHTML = "";
            const frag = document.createDocumentFragment();
            shown.forEach(([v, n]) => {
                const label = document.createElement("label");
                label.innerHTML = `<input type="checkbox"><b></b><span></span>`;
                const cb = label.querySelector("input");
                cb.value = v;
                cb.checked = this._gEdit.has(v);
                label.querySelector("b").textContent = groupLabel(v);
                label.querySelector("span").textContent = nf.format(n);
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
                this._setKindFilter(this._popKind, this._sel.filter(s => s.low).map(tokenText).join("; "));
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
                this._searchTimer = setTimeout(() => this._search(), 200);
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

        _openPopup(kind) {
            const sup = kind === "sup";
            this._popKind = kind;
            this._gpop.hidden = true;
            this._kodInput.value = this._matFilter;
            this._supInput.value = this._supFilter;
            this._root.getElementById("popTitle").textContent = sup ? "Tedarikçi seçimi" : "Malzeme seçimi";
            this._root.getElementById("popSearchLbl").textContent = sup ? "Tedarikçi ara" : "Malzeme ara";
            this._searchEl.placeholder = sup ? "örn. 200220 veya LIDA" : "örn. 1100253 veya RULMAN";
            const wrap = this._root.querySelector(".wrap").getBoundingClientRect();
            const btn = (sup ? this._supHeaderEl : this._kodHeaderEl).querySelector("button");
            this._pop.style.left = Math.max(8, Math.min(btn.getBoundingClientRect().left - wrap.left - 200, wrap.width - 468)) + "px";
            this._sel = splitList(sup ? this._supFilter : this._matFilter).map(parseToken);
            if (!this._sel.length) this._sel.push({ low: "", high: "" });
            this._renderSelRows();
            this._searchEl.value = "";
            this._pop.hidden = false;
            this._search();
            this._searchEl.focus();
        }

        _closePopup() {
            this._pop.hidden = true;
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
                row.innerHTML = `<input type="text" placeholder="alt / 11*"> – <input type="text" placeholder="üst (ops.)"><button title="Sil">×</button>`;
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

        _search() {
            const term = this._searchEl.value.trim();
            const sup = this._popKind === "sup";
            const all = sup ? this._supIds : this._allIds;
            const desc = sup ? this._supDesc : this._matDesc;
            const noun = sup ? "tedarikçi" : "malzeme";
            let hits;
            if (!term) {
                hits = all.slice(0, MAX_HITS + 1);
            } else {
                const lower = term.toLocaleLowerCase("tr-TR");
                const m = /[*?]/.test(term) ? matcher(term) : null;
                hits = [];
                for (let i = 0; i < all.length && hits.length <= MAX_HITS; i++) {
                    const id = all[i];
                    if (m ? m(id) : id.indexOf(term) >= 0 || (desc.get(id) || "").toLocaleLowerCase("tr-TR").indexOf(lower) >= 0) hits.push(id);
                }
            }
            const more = hits.length > MAX_HITS;
            this._hits = hits.slice(0, MAX_HITS);
            this._renderHits();
            this._hitInfoEl.textContent = this._hits.length
                ? `${this._hits.length} ${noun}${more ? ` (ilk ${MAX_HITS} gösteriliyor, aramayı daraltın)` : ""}`
                : `Eşleşen ${noun} yok.`;
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
                label.querySelector("span").textContent = (this._popKind === "sup" ? this._supDesc : this._matDesc).get(id) || "";
                frag.appendChild(label);
            });
            this._hitsEl.appendChild(frag);
        }
    }

    customElements.define("custom-usm-fiyat", UsmFiyat);
})();
