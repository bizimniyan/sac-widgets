(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js";
    const FFLATE_JS = "https://unpkg.com/fflate@0.8.2/esm/browser.js";
    const MAX_HITS = 200;
    const DATES_KEY = "sacPivotDates:";
    const NO_MASTER = new Set(["Date", "Version", "ZCURRENCY"]);
    const DIM_LABEL = { Date: "Dönem", Version: "Versiyon" };
    const DESC_ONLY = new Set(["ZPARAMETRE"]);
    const SCRIPT_ONLY = [["Version", "setVersion"], ["ZSIRKET_KODU", "setCompanyCode"]];
    const CUR_FREE = new Set(["ZORAN", "ZMIKTAR"]);
    const SUP_PARAMS = new Set(["USM0008"]);
    const TUTAR_MEASURES = ["ZTUTAR", "ZTUTAR_EUR", "ZTUTAR_USD", "ZTUTAR_TRY"];
    const SEP = "\u0001";
    const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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
        "xl/workbook.xml": XML + `<workbook xmlns="${SS}" xmlns:r="${OR}"><sheets><sheet name="Veri" sheetId="1" r:id="rId1"/></sheets></workbook>`,
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
    const and = (a, b) => a && b ? `${a} and ${b}` : a || b;
    const splitList = (text) => String(text || "").split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
    const memberId = (v) => {
        const m = String(v || "").trim().match(/&\[([^\]]*)\]$/);
        return m ? m[1] : String(v || "").trim();
    };
    const parseItems = (text) => splitList(text).map(s => {
        const i = s.indexOf(":");
        const id = (i > 0 ? s.slice(0, i) : s).trim();
        const dot = id.indexOf(".");
        const base = dot > 0 ? id.slice(0, dot) : id;
        const attr = dot > 0 ? id.slice(dot + 1) : "";
        return { id, base, attr, label: i > 0 ? s.slice(i + 1).trim() || id : DIM_LABEL[id] || attr || id };
    });
    const normVal = (dim, v) => {
        const x = memberId(v);
        return dim === "Version" && x && x.indexOf(".") < 0 ? "public." + x : x;
    };
    const parseFilters = (text) => {
        const out = new Map();
        let dim = "";
        String(text || "").split(/[;\n]/).forEach(part => {
            const i = part.indexOf("=");
            if (i > 0) dim = part.slice(0, i).trim();
            if (!dim) return;
            const vals = part.slice(i + 1).split(",").map(v => normVal(dim, v)).filter(Boolean);
            if (vals.length) out.set(dim, (out.get(dim) || []).concat(vals));
        });
        return out;
    };
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
        return cell.getData()._total ? "" : "–";
    };
    const errText = (e) => e && e.message ? e.message : String(e);

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
    const stopEvents = (el) => ["mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "contextmenu"]
        .forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));
    const readCache = (key) => {
        try { return JSON.parse(window.localStorage.getItem(DATES_KEY + key) || "null"); } catch (e) { return null; }
    };
    const writeCache = (key, val) => {
        try { window.localStorage.setItem(DATES_KEY + key, JSON.stringify(val)); } catch (e) { return; }
    };

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; }
            .bar { flex: 0 0 auto; display: flex; align-items: center; }
            #status { flex: 1 1 auto; font-size: 11px; color: #9a9a9a; padding: 4px 6px; }
            #mSelWrap { flex: 0 0 auto; font-size: 11px; color: #444; padding: 2px 6px; }
            #mSelWrap[hidden] { display: none; }
            #mSel { font: 11px Arial, sans-serif; padding: 1px 2px; border: 1px solid #ff0000; background: #ffe8e8; border-radius: 3px; color: #333; }
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
            .tabulator-row .tabulator-cell.tot { font-weight: 600; }
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
            #search { font: 12px Arial, sans-serif; padding: 3px 5px; border: 1px solid #c4c4c4; border-radius: 3px; }
            .pop-b > .hits { margin-top: 4px; border: 1px solid #eee; overflow: auto; flex: 1 1 auto; min-height: 90px; }
            .hits label { display: flex; gap: 6px; align-items: center; padding: 2px 6px; cursor: pointer; white-space: nowrap; }
            .hits label:nth-child(even) { background: #fafafa; }
            .hits label:hover { background: #ffe8e8; }
            .hits b { flex: 0 0 90px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
            .hits span { overflow: hidden; text-overflow: ellipsis; color: #444; }
            .hit-info { color: #888; margin-top: 3px; min-height: 14px; }
            .pop-f { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid #eee; }
            .pop-f .sp { flex: 1; }
            .pop-f button { padding: 3px 12px; }
            .pop-f .primary { background: #ff0000; border-color: #ff0000; color: #fff; }
            .pop-f .primary:hover { background: #ff3333; }
        </style>
        <div class="wrap">
            <div class="bar"><label id="mSelWrap" hidden>Measure: <select id="mSel"></select></label><div id="status">Yükleniyor…</div><button id="xls">Excel'e aktar</button></div>
            <div id="table"></div>
            <div id="pop" class="pop" hidden>
                <div class="pop-h"><span id="popTitle"></span><button class="x" id="popClose" title="Kapat">×</button></div>
                <div class="pop-b">
                    <div class="pop-sec">Seçimler <small>(tek kod, 11* veya alt – üst aralık)</small></div>
                    <div id="selRows" class="sel-rows"></div>
                    <button id="addRow" class="link">+ satır</button>
                    <div class="pop-sec"><span id="popSearchLbl"></span> <small>(kod veya tanım; işaretle = seçimlere ekle)</small></div>
                    <input id="search" type="text" placeholder="kod veya tanım">
                    <div id="hits" class="hits"></div>
                    <div id="hitInfo" class="hit-info"></div>
                </div>
                <div class="pop-f">
                    <button id="popClear">Temizle</button><span class="sp"></span>
                    <button id="popCancel">İptal</button><button id="popOk" class="primary">Uygula</button>
                </div>
            </div>
        </div>
    `;

    class SacPivot extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._root = shadowRoot;
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._xlsBtn = shadowRoot.getElementById("xls");
            this._xlsBtn.addEventListener("click", () => this.exportExcel());
            this._mSelWrap = shadowRoot.getElementById("mSelWrap");
            this._mSel = shadowRoot.getElementById("mSel");
            TUTAR_MEASURES.forEach(id => this._mSel.add(new Option(id, id)));
            this._tutar = TUTAR_MEASURES[0];
            this._mSel.addEventListener("change", () => this.setMeasureSelection(this._mSel.value));
            this._table = null;
            this._token = 0;
            this._sel = new Map();
            this._match = new Map();
            this._override = new Map();
            this._inputs = new Map();
            this._desc = new Map();
            this._rowDims = [];
            this._rows = [];
            this._shown = [];
            this._leaves = [];
            this._initPopup();
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if (["providerId", "rowDims", "colDims", "filters", "measures", "measureSelect"].some(k => k in changedProperties)) this._scheduleReload();
        }

        onCustomWidgetResize() {
            if (this._table) this._table.redraw();
        }

        setFilter(dimension, values) {
            const dim = String(dimension || "").trim();
            if (!dim) return;
            this._override.set(dim, String(values || "").split(/[,;]/).map(v => normVal(dim, v)).filter(Boolean));
            this._scheduleReload();
        }

        setVersion(version) {
            this.setFilter("Version", version);
        }

        setCompanyCode(companyCode) {
            this.setFilter("ZSIRKET_KODU", companyCode);
        }

        setMeasureSelection(measure) {
            const id = String(measure || "").trim().toUpperCase();
            if (TUTAR_MEASURES.indexOf(id) < 0) return;
            this._tutar = id;
            this._mSel.value = id;
            this._scheduleReload();
        }

        getMeasureSelection() {
            return this._tutar;
        }

        getFilter(dimension) {
            return (this._loadParams().filters.get(String(dimension || "").trim()) || []).join(",");
        }

        setSelection(dimension, values) {
            this._setSel(String(dimension || "").trim(), values);
        }

        getSelection(dimension) {
            return this._sel.get(String(dimension || "").trim()) || "";
        }

        refresh() {
            return this._reload(true);
        }

        _setSel(dim, text) {
            if (!dim) return;
            const v = splitList(text).join("; ");
            if (v === (this._sel.get(dim) || "")) return;
            if (v) this._sel.set(dim, v);
            else this._sel.delete(dim);
            const m = matcher(v);
            if (m) this._match.set(dim, m);
            else this._match.delete(dim);
            const input = this._inputs.get(dim);
            if (input) input.value = v;
            this._applyFilter();
        }

        _scheduleReload() {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => this._reload(false), 150);
        }

        _loadParams() {
            const pid = (this.providerId || "").trim();
            const rows = parseItems(this.rowDims);
            const cols = parseItems(this.colDims);
            const measures = parseItems(this.measures);
            const tutarOn = !!String(this.measureSelect || "").trim();
            this._mSelWrap.hidden = !tutarOn;
            if (tutarOn && !measures.some(m => m.id === this._tutar)) {
                measures.push({ id: this._tutar, base: this._tutar, attr: "", label: this._tutar });
            }
            const filters = parseFilters(this.filters);
            SCRIPT_ONLY.forEach(([d]) => filters.delete(d));
            this._override.forEach((vals, dim) => { if (vals.length) filters.set(dim, vals); else filters.delete(dim); });
            const fl = Array.from(filters.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
            const sig = JSON.stringify([pid, rows, cols, measures, fl]);
            return { pid, rows, cols, measures, filters, sig };
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
            this._pop.hidden = true;
            if (!p.pid || !p.rows.length || !p.measures.length) {
                this._destroyTable();
                this._setStatus("Builder panelinden model, satır boyutları ve measure girin.");
                return;
            }
            const missing = SCRIPT_ONLY.filter(([d]) => !this._override.has(d)).map(([, m]) => m);
            if (missing.length) {
                this._destroyTable();
                this._loadSig = null;
                this._setStatus(`Script ile verilmesi bekleniyor: ${missing.join(", ")}`);
                return;
            }
            const filter = Array.from(p.filters.entries()).filter(([d]) => d.indexOf(".") < 0).map(([d, vals]) => orEq(d, vals)).join(" and ");
            const attrFilters = parseItems(Array.from(p.filters.keys()).filter(d => d.indexOf(".") > 0).join(","));
            const items = p.rows.concat(p.cols, attrFilters);
            const dims = Array.from(new Set(items.map(d => d.base)));
            const attrs = new Map();
            items.forEach(d => {
                if (!d.attr) return;
                if (!attrs.has(d.base)) attrs.set(d.base, new Set());
                attrs.get(d.base).add(d.attr);
            });
            const mIds = p.measures.map(m => m.id);
            const t0 = Date.now();
            this._setStatus("Yükleniyor…");

            try {
                let dates = [null];
                let datesP = null;
                let cached = null;
                if (dims.indexOf("Date") >= 0) {
                    if (p.filters.has("Date")) {
                        dates = p.filters.get("Date");
                    } else {
                        datesP = this._get("FactDataAggregation", { $select: "Date," + mIds.join(","), $filter: filter })
                            .then(rows => Array.from(new Set(rows.map(r => r.Date).filter(Boolean))).sort());
                        datesP.catch(() => {});
                        cached = readCache(p.sig);
                        dates = cached || await datesP;
                    }
                }
                const masterDims = dims.filter(d => !NO_MASTER.has(d) || attrs.has(d));
                const sel = dims.concat(mIds).join(",");
                let done = 0;
                const total = dates.length + masterDims.length;
                const step = (pr) => pr.then(v => {
                    done++;
                    if (token === this._token && !this._table) this._setStatus(`Yükleniyor… ${done} / ${total}`);
                    return v;
                });
                const [, masters, valueSets] = await Promise.all([
                    loadScript(TABULATOR_JS),
                    Promise.all(masterDims.map(d => step(this._get(`${d}Master`, { $select: ["ID", "Description"].concat(Array.from(attrs.get(d) || [])).join(",") })
                        .catch(e => { if (attrs.has(d)) throw new Error(`${d} özellikleri okunamadı (${Array.from(attrs.get(d)).join(", ")}): ${errText(e)}`); return []; })))),
                    Promise.all(dates.map(d => step(this._get("FactDataAggregation", {
                        $select: sel,
                        $filter: d === null ? filter : and(filter, `Date eq '${q(d)}'`)
                    }))))
                ]);
                if (token !== this._token) return;
                if (datesP && cached) {
                    datesP.then(fresh => {
                        if (token !== this._token) return;
                        writeCache(p.sig, fresh);
                        if (fresh.join() !== cached.join()) this._reload(true);
                    }).catch(() => {});
                } else if (datesP) {
                    writeCache(p.sig, dates);
                }
                this._desc = new Map();
                this._attrs = new Map();
                masterDims.forEach((d, i) => {
                    const m = new Map();
                    masters[i].forEach(r => { if (r.Description) m.set(r.ID, r.Description); });
                    if (m.size && !NO_MASTER.has(d)) this._desc.set(d, m);
                    if (attrs.has(d)) this._attrs.set(d, new Map(masters[i].map(r => [r.ID, r])));
                });
                this._buildData(p, valueSets, attrFilters);
                if (!this._rows.length) {
                    this._destroyTable();
                    this._setStatus("Bu filtrelerle veri yok.");
                    return;
                }
                this._buildTable(p);
                this._loadMs = Date.now() - t0;
                this._updateStatus();
            } catch (e) {
                if (token !== this._token || (e && e.name === "AbortError")) return;
                this._loadSig = null;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        _label(dim, v) {
            const d = this._desc.get(dim);
            const desc = d && d.get(v);
            if (!v) return desc || "(boş)";
            return !desc ? v : DESC_ONLY.has(dim) ? desc : `${v} - ${desc}`;
        }

        _twoCols(dim) {
            return this._desc.has(dim) && !DESC_ONLY.has(dim);
        }

        _valueOf(d, r) {
            if (!d.attr) return String(r[d.id] === undefined || r[d.id] === null ? "" : r[d.id]);
            const m = this._attrs.get(d.base);
            const rec = m && m.get(r[d.base]);
            const v = rec && rec[d.attr];
            return v === undefined || v === null ? "" : String(v);
        }

        _buildData(p, valueSets, attrFilters) {
            const rowIds = p.rows.map(d => d.id);
            const mIds = p.measures.map(m => m.id);
            const af = attrFilters.map(d => [d, new Set(p.filters.get(d.id))]);
            const withTotal = p.cols.length > 0;
            const pIdx = p.cols.length > 1 ? p.cols.findIndex(d => d.id === "ZPARAMETRE") : -1;
            const tParams = new Map();
            const tUsed = new Set();
            const byRow = new Map();
            const colIndex = new Map();
            const cols = [];
            const curIdx = p.rows.findIndex(d => d.id === "ZCURRENCY");
            const matIdx = p.rows.findIndex(d => d.id === "ZMALZEME");
            const supOn = p.rows.some(d => d.id === "ZTEDARIKCI");
            const free = mIds.map(m => CUR_FREE.has(m));
            const isNone = (v) => v === "#" || v === "";
            const freeVals = [];
            const vUsed = new Set();
            this._vUsed = vUsed;
            const add = (row, ci, mi, x) => {
                const f = `v${ci}_${mi}`;
                row[f] = (row[f] || 0) + x;
                vUsed.add(f);
                if (!withTotal) return;
                let tf = "t_" + mi;
                if (pIdx >= 0) {
                    const pv = cols[ci].vals[pIdx];
                    let k = tParams.get(pv);
                    if (k === undefined) tParams.set(pv, k = tParams.size);
                    tf = `t${k}_${mi}`;
                    tUsed.add(tf);
                }
                row[tf] = (row[tf] || 0) + x;
            };
            const newRow = (rk, rvals) => {
                const row = { key: rk };
                rvals.forEach((v, i) => {
                    row["r" + i] = v;
                    const d = this._desc.get(rowIds[i]);
                    if (d) row[`r${i}d`] = d.get(v) || "";
                });
                byRow.set(rk, row);
                return row;
            };
            const keyOf = (rvals, wild) => rvals.map((v, i) => wild.indexOf(i) >= 0 ? "" : v).join(SEP);
            valueSets.forEach(recs => recs.forEach(r => {
                const nums = mIds.map(m => {
                    const x = r[m];
                    return x === null || x === undefined || x === "" ? null : Number(x);
                });
                if (nums.every(x => x === null)) return;
                for (let k = 0; k < af.length; k++) if (!af[k][1].has(this._valueOf(af[k][0], r))) return;
                const cvals = p.cols.map(d => this._valueOf(d, r));
                const ck = cvals.join(SEP);
                let ci = colIndex.get(ck);
                if (ci === undefined) {
                    colIndex.set(ck, ci = cols.length);
                    cols.push({ ci, vals: cvals });
                }
                const rvals = p.rows.map(d => this._valueOf(d, r));
                const curWild = curIdx >= 0 && isNone(rvals[curIdx]) ? [curIdx] : [];
                const supWild = supOn && SUP_PARAMS.has(r.ZPARAMETRE) ? [matIdx, curIdx].filter(i => i >= 0 && isNone(rvals[i])) : [];
                const rk = rvals.join(SEP);
                let row = null;
                nums.forEach((x, mi) => {
                    if (x === null) return;
                    const wild = supWild.length ? supWild : free[mi] ? curWild : [];
                    if (wild.length) {
                        freeVals.push({ wild, sup: supWild.length > 0, rk, rvals, ci, mi, x });
                        return;
                    }
                    if (!row) row = byRow.get(rk) || newRow(rk, rvals);
                    add(row, ci, mi, x);
                });
            }));
            if (freeVals.length) {
                freeVals.sort((a, b) => a.sup - b.sup);
                const caches = new Map();
                freeVals.forEach(fv => {
                    const wk = fv.wild.join(",");
                    let groups = caches.get(wk);
                    if (!groups) {
                        caches.set(wk, groups = new Map());
                        byRow.forEach(row => {
                            const ok = keyOf(rowIds.map((_, i) => row["r" + i]), fv.wild);
                            if (!groups.has(ok)) groups.set(ok, []);
                            groups.get(ok).push(row);
                        });
                    }
                    const ok = keyOf(fv.rvals, fv.wild);
                    let targets = groups.get(ok);
                    if (!targets) groups.set(ok, targets = [byRow.get(fv.rk) || newRow(fv.rk, fv.rvals)]);
                    targets.forEach(row => add(row, fv.ci, fv.mi, fv.x));
                });
            }
            const orders = p.cols.map(d => d.id).map(d => {
                const fixed = p.filters.get(d);
                const pos = fixed ? new Map(fixed.map((v, i) => [v, i])) : null;
                return (a, b) => {
                    if (pos) {
                        const pa = pos.has(a) ? pos.get(a) : 1e9, pb = pos.has(b) ? pos.get(b) : 1e9;
                        if (pa !== pb) return pa - pb;
                    }
                    return cmpCode(a, b);
                };
            });
            cols.sort((a, b) => {
                for (let i = 0; i < orders.length; i++) {
                    const c = orders[i](a.vals[i], b.vals[i]);
                    if (c) return c;
                }
                return 0;
            });
            this._totCols = !withTotal ? [] : pIdx < 0 ? mIds.map((m, mi) => ({ field: "t_" + mi, mi }))
                : [].concat(...Array.from(tParams.keys()).sort(orders[pIdx]).map(pv => mIds.map((m, mi) => ({ field: `t${tParams.get(pv)}_${mi}`, mi, param: pv }))))
                    .filter(t => tUsed.has(t.field));
            const rows = Array.from(byRow.values());
            rows.sort((a, b) => {
                for (let i = 0; i < rowIds.length; i++) {
                    const c = cmpCode(a["r" + i], b["r" + i]);
                    if (c) return c;
                }
                return 0;
            });
            this._rows = rows;
            this._cols = cols;
            this._rowDims = p.rows;
            this._dimIds = new Map();
        }

        _columnDefs(p) {
            const colIds = p.cols.map(d => d.id);
            const ms = p.measures;
            const nc = colIds.length;
            this._leaves = [];
            const leaf = (c, mi, title) => {
                const path = c.vals.map((v, i) => this._label(colIds[i], v));
                if (ms.length > 1 || !nc) path.push(ms[mi].label);
                const field = `v${c.ci}_${mi}`;
                this._leaves.push({ field, title: path.join(" / ") });
                return {
                    title, field, headerTooltip: c.vals.concat(ms.length > 1 || !nc ? [ms[mi].id] : []).join(" / "), headerWordWrap: true,
                    width: 105, hozAlign: "right", formatter: numFormatter, accessorClipboard: numCopy
                };
            };
            const used = this._vUsed;
            const slots = colIds.map((_, i) => i);
            if (ms.length > 1) slots.splice(colIds.indexOf("Date") >= 0 ? colIds.indexOf("Date") : nc, 0, "M");
            const build = (list, si, mi) => {
                const slot = slots[si];
                const last = si === slots.length - 1;
                if (slot === "M") {
                    return ms.map((m, k) => {
                        const sub = list.filter(c => used.has(`v${c.ci}_${k}`));
                        if (!sub.length) return null;
                        return last ? leaf(sub[0], k, m.label) : { title: m.label, headerTooltip: m.id, cssClass: "pgroup", columns: build(sub, si + 1, k) };
                    }).filter(Boolean);
                }
                const groups = [];
                list.forEach(c => {
                    const g = groups[groups.length - 1];
                    if (g && g.v === c.vals[slot]) g.list.push(c);
                    else groups.push({ v: c.vals[slot], list: [c] });
                });
                return groups.map(g => {
                    const title = this._label(colIds[slot], g.v);
                    if (last) {
                        const k = mi === undefined ? 0 : mi;
                        return used.has(`v${g.list[0].ci}_${k}`) ? leaf(g.list[0], k, title) : null;
                    }
                    const kids = build(g.list, si + 1, mi);
                    return kids.length ? { title, headerTooltip: g.v, cssClass: "pgroup", columns: kids } : null;
                }).filter(Boolean);
            };
            const defs = !this._cols.length ? [] : slots.length ? build(this._cols, 0)
                : used.has(`v${this._cols[0].ci}_0`) ? [leaf(this._cols[0], 0, ms[0].label)] : [];
            if (nc && defs.length && this._totCols.length) {
                const byParam = this._totCols[0].param !== undefined;
                const tot = this._totCols.map(t => {
                    const pl = byParam ? this._label("ZPARAMETRE", t.param) : "";
                    const title = byParam ? (ms.length > 1 ? `${pl} ${ms[t.mi].label}` : pl) : ms.length > 1 ? ms[t.mi].label : "Toplam";
                    return { title, field: t.field, headerTooltip: "Satır toplamı", headerWordWrap: true, width: 115, hozAlign: "right", formatter: numFormatter, accessorClipboard: numCopy, cssClass: "tot" };
                });
                this._leaves.unshift(...tot.map(c => ({ field: c.field, title: c.title === "Toplam" ? c.title : `Toplam / ${c.title}` })));
                defs.unshift(tot.length > 1 || byParam ? { title: "Toplam", cssClass: "pgroup", columns: tot } : tot[0]);
            }
            const firstLeaf = (c) => c.columns ? firstLeaf(c.columns[0]) : c;
            defs.forEach(c => { const l = firstLeaf(c); l.cssClass = l.cssClass ? l.cssClass + " pstart" : "pstart"; });
            return defs;
        }

        _filtered() {
            const tests = [];
            this._rowDims.forEach((d, i) => {
                const m = this._match.get(d.id);
                if (m) tests.push([`r${i}`, m]);
            });
            if (!tests.length) return this._rows;
            return this._rows.filter(r => tests.every(([f, m]) => m(r[f])));
        }

        _totalRow() {
            const shown = this._shown;
            const row = { key: "TOTAL", _total: true };
            this._rowDims.forEach((d, i) => {
                row["r" + i] = "";
                if (this._twoCols(d.id)) row[`r${i}d`] = "";
            });
            row.r0 = "Toplam";
            if (this._twoCols(this._rowDims[0].id)) row.r0d = `${nf.format(shown.length)} satır`;
            const fields = this._leaves.map(c => c.field);
            fields.forEach(f => { row[f] = null; });
            shown.forEach(r => {
                for (let i = 0; i < fields.length; i++) {
                    const v = r[fields[i]];
                    if (v !== undefined) row[fields[i]] = (row[fields[i]] || 0) + v;
                }
            });
            return row;
        }

        _applyFilter() {
            this._inputs.forEach((input, dim) => input.classList.toggle("on", this._sel.has(dim)));
            if (!this._table) return;
            this._shown = this._filtered();
            this._table.replaceData([this._totalRow()].concat(this._shown));
            this._updateStatus();
        }

        _buildTable(p) {
            this._destroyTable();
            this._inputs = new Map();
            const columns = [];
            p.rows.forEach((d, i) => {
                const descOnly = DESC_ONLY.has(d.id) && this._desc.has(d.id);
                columns.push({
                    title: d.label, field: "r" + i, width: 150, frozen: i === 0, titleFormatter: () => this._buildHeader(i, d),
                    formatter: descOnly ? (cell) => cell.getData()[`r${i}d`] || cell.getValue() : undefined,
                    accessorClipboard: descOnly ? (v, data) => data[`r${i}d`] || v : textCopy
                });
                if (this._twoCols(d.id)) columns.push({ title: d.label + " Tanımı", field: `r${i}d`, width: 230, frozen: i === 0, cssClass: "soft" });
            });
            const valueDefs = this._columnDefs(p);
            this._shown = this._filtered();
            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: [this._totalRow()].concat(this._shown),
                frozenRows: 1,
                height: "100%",
                rowHeight: 26,
                layout: "fitData",
                columns: columns.concat(valueDefs),
                columnDefaults: { headerSort: false, resizable: "header", accessorClipboard: textCopy },
                selectableRange: 1,
                selectableRangeColumns: true,
                clipboard: "copy",
                clipboardCopyRowRange: "range",
                clipboardCopyStyled: false,
                clipboardCopyConfig: { columnHeaders: false, columnGroups: false, rowHeaders: false, columnCalcs: false },
                placeholder: "Seçime uyan satır yok",
                rowFormatter: (row) => { if (row.getData()._total) row.getElement().classList.add("row-total"); }
            });
        }

        _buildHeader(i, d) {
            const el = document.createElement("div");
            el.innerHTML = `<div></div><div class="kod-f"><input type="text" placeholder="kod, 11*, alt-üst"><button title="Çoklu seçim">⋯</button></div>`;
            el.firstChild.textContent = d.label;
            const box = el.querySelector(".kod-f");
            const input = box.querySelector("input");
            const btn = box.querySelector("button");
            input.value = this._sel.get(d.id) || "";
            input.classList.toggle("on", this._sel.has(d.id));
            this._inputs.set(d.id, input);
            stopEvents(box);
            input.addEventListener("keydown", e => {
                if (e.key === "Enter") this._setSel(d.id, input.value);
                if (e.key === "Escape") { input.value = this._sel.get(d.id) || ""; input.blur(); }
            });
            input.addEventListener("change", () => this._setSel(d.id, input.value));
            btn.addEventListener("click", () => this._openPopup(i, btn));
            return el;
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
            btn.textContent = "Excel hazırlanıyor…";
            try {
                const fflate = await import(FFLATE_JS);
                await tick();
                const dims = this._rowDims;
                const head = [];
                dims.forEach(d => {
                    head.push(d.label);
                    if (this._twoCols(d.id)) head.push(d.label + " Tanımı");
                });
                const leaves = this._leaves;
                leaves.forEach(c => head.push(c.title));
                const file = xlsxFile(fflate, head.map((_, i) => colName(i)));
                file.head(head);
                const rows = this._shown;
                for (let n = 0; n < rows.length; n++) {
                    const r = rows[n];
                    const cells = [];
                    dims.forEach((d, i) => {
                        cells.push(DESC_ONLY.has(d.id) ? r[`r${i}d`] || r["r" + i] : r["r" + i]);
                        if (this._twoCols(d.id)) cells.push(r[`r${i}d`]);
                    });
                    for (let k = 0; k < leaves.length; k++) {
                        const v = r[leaves[k].field];
                        cells.push(v !== undefined && v !== null ? Math.round(v * 1e6) / 1e6 : null);
                    }
                    file.add(cells);
                }
                const name = `Veri_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
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
            this._setStatus(`${n === all ? nf.format(all) : `${nf.format(n)} / ${nf.format(all)}`} satır${secs}`);
        }

        _destroyTable() {
            if (this._table) {
                this._table.destroy();
                this._table = null;
            }
            this._tableEl.innerHTML = "";
        }

        async _get(path, params) {
            const qs = Object.keys(params).filter(k => params[k]).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
            let url = `${window.location.origin}/api/v1/dataexport/providers/sac/${encodeURIComponent(this._pid)}/${path}${qs ? "?" + qs : ""}`;
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
            $("popClear").addEventListener("click", () => { this._selEdit = []; this._renderSelRows(); this._renderHits(); });
            $("popOk").addEventListener("click", () => {
                this._readSelRows();
                this._closePopup();
                this._setSel(this._rowDims[this._popIdx].id, this._selEdit.filter(s => s.low).map(tokenText).join("; "));
            });
            $("addRow").addEventListener("click", () => {
                this._readSelRows();
                this._selEdit.push({ low: "", high: "" });
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
                    if (!this._selEdit.some(s => !s.high && s.low === id)) this._selEdit.push({ low: id, high: "" });
                } else {
                    this._selEdit = this._selEdit.filter(s => s.high || s.low !== id);
                }
                this._renderSelRows();
            });
            this._pop.addEventListener("keydown", (e) => { if (e.key === "Escape") this._closePopup(); });
        }

        _openPopup(i, btn) {
            const d = this._rowDims[i];
            this._popIdx = i;
            if (!this._dimIds.has(i)) this._dimIds.set(i, Array.from(new Set(this._rows.map(r => r["r" + i]))).sort(cmpCode));
            this._root.getElementById("popTitle").textContent = `${d.label} seçimi`;
            this._root.getElementById("popSearchLbl").textContent = `${d.label} ara`;
            const input = this._inputs.get(d.id);
            if (input) input.value = this._sel.get(d.id) || "";
            const wrap = this._root.querySelector(".wrap").getBoundingClientRect();
            this._pop.style.left = Math.max(8, Math.min(btn.getBoundingClientRect().left - wrap.left - 200, wrap.width - 468)) + "px";
            this._selEdit = splitList(this._sel.get(d.id)).map(parseToken);
            if (!this._selEdit.length) this._selEdit.push({ low: "", high: "" });
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
            this._selEdit = Array.from(this._selRowsEl.querySelectorAll(".sel-row")).map(r => {
                const [lo, hi] = r.querySelectorAll("input");
                return { low: lo.value.trim(), high: hi.value.trim() };
            });
        }

        _renderSelRows() {
            this._selRowsEl.innerHTML = "";
            this._selEdit.forEach((s, i) => {
                const row = document.createElement("div");
                row.className = "sel-row";
                row.innerHTML = `<input type="text" placeholder="alt / 11*"> – <input type="text" placeholder="üst (ops.)"><button title="Sil">×</button>`;
                const [lo, hi] = row.querySelectorAll("input");
                lo.value = s.low;
                hi.value = s.high;
                row.querySelector("button").addEventListener("click", () => {
                    this._readSelRows();
                    this._selEdit.splice(i, 1);
                    this._renderSelRows();
                    this._renderHits();
                });
                this._selRowsEl.appendChild(row);
            });
        }

        _popLabel(id) {
            const d = this._rowDims[this._popIdx];
            const desc = this._desc.get(d.id);
            return desc ? desc.get(id) || "" : "";
        }

        _search() {
            const term = this._searchEl.value.trim();
            const all = this._dimIds.get(this._popIdx) || [];
            let hits;
            if (!term) {
                hits = all.slice(0, MAX_HITS + 1);
            } else {
                const lower = term.toLocaleLowerCase("tr-TR");
                const m = /[*?]/.test(term) ? matcher(term) : null;
                hits = [];
                for (let i = 0; i < all.length && hits.length <= MAX_HITS; i++) {
                    const id = all[i];
                    if (m ? m(id) : id.indexOf(term) >= 0 || this._popLabel(id).toLocaleLowerCase("tr-TR").indexOf(lower) >= 0) hits.push(id);
                }
            }
            const more = hits.length > MAX_HITS;
            this._hits = hits.slice(0, MAX_HITS);
            this._renderHits();
            this._hitInfoEl.textContent = this._hits.length
                ? `${this._hits.length} değer${more ? ` (ilk ${MAX_HITS} gösteriliyor, aramayı daraltın)` : ` / ${all.length}`}`
                : "Eşleşen değer yok.";
        }

        _renderHits() {
            if (!this._hits) return;
            const singles = new Set((this._selEdit || []).filter(s => !s.high).map(s => s.low));
            this._hitsEl.innerHTML = "";
            const frag = document.createDocumentFragment();
            this._hits.forEach(id => {
                const label = document.createElement("label");
                label.innerHTML = `<input type="checkbox"><b></b><span></span>`;
                const cb = label.querySelector("input");
                cb.value = id;
                cb.checked = singles.has(id);
                label.querySelector("b").textContent = id;
                label.querySelector("span").textContent = this._popLabel(id);
                frag.appendChild(label);
            });
            this._hitsEl.appendChild(frag);
        }
    }

    customElements.define("custom-sac-pivot", SacPivot);
})();
