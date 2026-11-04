(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js";
    const FFLATE_JS = "https://unpkg.com/fflate@0.8.2/esm/browser.js";
    const NONE = "#";
    const CHUNK = 40;
    const MAX_HITS = 200;
    const MEASURES = ["ZTUTAR_TRY", "ZTUTAR_EUR", "ZTUTAR_USD"];
    const DEFAULT_MEASURE = "ZTUTAR_TRY";
    const DEFAULT_PARAMS = "USM0025,USM0026,USM0027,USM0028";
    const TYPE_LABEL = { M: "Malzeme", O: "Masraf Öğesi", B: "Bileşen" };
    const DIM = { M: "ZMALZEME", O: "ZMASRAF_OGESI", B: "ZBILESEN" };
    const TOT = "TOT";
    const EMPTY_SET = new Set();
    const EXPORT_ROWS = 200000;
    const XLSX_MAX_ROWS = 1048575;
    const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const XLSX_HEAD = ["Seviye", "Ana Malzeme", "Üst Kod", "Masraf Öğesi", "Kod", "Açıklama", "Grup 1", "Grup 2", "Tür"];

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
        "xl/workbook.xml": XML + `<workbook xmlns="${SS}" xmlns:r="${OR}"><sheets><sheet name="USM" sheetId="1" r:id="rId1"/></sheets></workbook>`,
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
    const xlsxPart = (fflate, cols) => {
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
            rows: () => n,
            head: (cells) => row(cells, ' s="1"'),
            add: (cells) => row(cells, ""),
            finish: () => { buf.push("</sheetData></worksheet>"); flush(true); zip.end(); return out; }
        };
    };
    const zipFiles = (fflate, files) => {
        const out = [];
        const zip = new fflate.Zip((err, data) => { if (err) throw err; out.push(data); });
        files.forEach(f => {
            const entry = new fflate.ZipPassThrough(f.name);
            zip.add(entry);
            f.data.forEach((c, i) => entry.push(c, i === f.data.length - 1));
        });
        zip.end();
        return out;
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
    const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
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
        return d._kind === "P" || d._wait ? "" : "–";
    };
    const isZero = (v) => !(Math.abs(v) >= 1e-9);
    const hasVal = (o) => {
        if (o) for (const k in o) if (!isZero(o[k])) return true;
        return false;
    };
    const addInto = (target, src) => {
        for (const k in src) target[k] = (target[k] || 0) + src[k];
        return target;
    };
    const scaleVals = (vals, fac) => {
        const out = {};
        for (const k in vals) {
            const x = vals[k] * (fac[k] || 0);
            if (x) out[k] = x;
        }
        return out;
    };
    const addRec = (agg, r, measure) => {
        const x = r[measure];
        if (x === null || x === undefined || !r.Date || r.Date === NONE || !r.ZMALZEME || r.ZMALZEME === NONE) return;
        const f = fieldOf(r.Date, r.ZPARAMETRE);
        const mo = r.ZMASRAF_OGESI || NONE;
        let m = agg.get(r.ZMALZEME);
        if (!m) agg.set(r.ZMALZEME, m = { vals: {}, mos: new Map() });
        let o = m.mos.get(mo);
        if (!o) m.mos.set(mo, o = { vals: {}, sum: {}, comps: new Map() });
        m.vals[f] = (m.vals[f] || 0) + x;
        o.vals[f] = (o.vals[f] || 0) + x;
        if (r.ZBILESEN && r.ZBILESEN !== NONE) {
            let c = o.comps.get(r.ZBILESEN);
            if (!c) o.comps.set(r.ZBILESEN, c = {});
            c[f] = (c[f] || 0) + x;
            o.sum[f] = (o.sum[f] || 0) + x;
        }
    };
    const finishAgg = (agg) => agg.forEach(m => {
        m.moIds = Array.from(m.mos.keys()).sort(cmpCode);
        m.mos.forEach(o => { o.compIds = Array.from(o.comps.keys()).sort(cmpCode); });
    });
    const errText = (e) => e && e.message ? e.message : String(e);
    const descFormatter = (cell) => {
        const d = cell.getData();
        if (d._kind === "P") return "";
        const el = document.createElement("span");
        if (d.desc === null || d.desc === undefined) {
            el.className = "loading";
            el.innerHTML = "<i></i>yükleniyor…";
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
            .bar { flex: 0 0 auto; display: flex; align-items: center; }
            #status { flex: 1 1 auto; font-size: 11px; color: #9a9a9a; padding: 4px 6px; }
            #status.error { color: #bb0000; white-space: pre-wrap; }
            .bbtn, #meas { flex: 0 0 auto; margin: 2px 0 2px 6px; padding: 1px 8px; font: 11px Arial, sans-serif; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; }
            .bbtn { cursor: pointer; }
            .bbtn:hover:not(:disabled) { background: #ffe8e8; }
            .bbtn:disabled { color: #999; cursor: default; }
            .bbtn.on { border-color: #ff0000; background: #ffe8e8; }
            #meas { padding: 1px 2px; }
            #meas:focus { outline: 1px solid #ff0000; outline-offset: 0; border-color: #ff0000; }
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
            .tabulator-row.row-mo { color: #333; }
            .tabulator-row.row-placeholder { color: #aaa; }
            .tabulator-row .tabulator-data-tree-control { border: 1px solid #bdbdbd !important; background: #fff !important; }
            .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-expand, .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-expand:after,
            .tabulator-row .tabulator-data-tree-control .tabulator-data-tree-control-collapse:after { background: #7a7a7a !important; }
            .tabulator-row .tabulator-data-tree-branch { border-color: #d6d6d6 !important; }
            .tabulator-row.leaf .tabulator-data-tree-branch { margin-right: 23px; }
            /* Tabulator girintiyi branch offsetWidth ile hesaplıyor, satır DOM dışında çizilince 0 okuyup kayıyor: seviye başına sabit */
            ${Array.from({ length: 30 }, (_, i) => `.tabulator-row.tabulator-tree-level-${i + 1} .tabulator-data-tree-branch { margin-left: ${9 * i + 22 * (i + 1)}px !important; }`).join("\n            ")}
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
            .kod-f .gbtn.mbtn { flex: 0 0 auto; width: 96px; }
            .kod-f .gbtn.on { border-color: #ff0000 !important; background: #ffe8e8 !important; }
            .gpop { width: 300px; }
            .gpop .hits b { flex: 1 1 auto; font-weight: normal; overflow: hidden; text-overflow: ellipsis; }
            .gpop .hits span { flex: 0 0 auto; color: #888; }
        </style>
        <div class="wrap">
            <div class="bar"><select id="meas" title="Measure"></select><button id="xls" class="bbtn">Excel'e aktar</button><div id="status">Yükleniyor…</div></div>
            <div id="table"></div>
            <div id="pop" class="pop" hidden>
                <div class="pop-h"><span id="popTitle">Malzeme seçimi</span><button class="x" id="popClose" title="Kapat">×</button></div>
                <div class="pop-b">
                    <div class="pop-sec">Seçimler <small>(tek kod, 2* veya alt – üst aralık)</small></div>
                    <div id="selRows" class="sel-rows"></div>
                    <button id="addRow" class="link">+ satır</button>
                    <div class="pop-sec"><span id="popSearchLbl">Malzeme ara</span> <small>(kod veya tanım; işaretle = seçimlere ekle)</small></div>
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

    class UsmTutar extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._root = shadowRoot;
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._xlsBtn = shadowRoot.getElementById("xls");
            this._xlsBtn.addEventListener("click", () => this.exportExcel());
            this._measEl = shadowRoot.getElementById("meas");
            MEASURES.forEach(m => this._measEl.add(new Option(m, m)));
            this._measEl.addEventListener("change", () => this.setMeasure(this._measEl.value));
            stopEvents(this._measEl);
            this._table = null;
            this._token = 0;
            this._measure = DEFAULT_MEASURE;
            this._measEl.value = this._measure;
            this._matFilter = "";
            this._types = new Set(["M", "Y"]);
            this._compFilter = "";
            this._compMatch = null;
            this._used = null;
            this._matVals = null;
            this._resetChildren();
            this._allIds = [];
            this._ids = [];
            this._compIds = [];
            this._compSet = new Set();
            this._parentSet = new Set();
            this._moIds = [];
            this._desc = { ZMALZEME: new Map(), ZBILESEN: new Map(), ZMASRAF_OGESI: new Map() };
            this._attr = { ZMALZEME: new Map(), ZBILESEN: new Map() };
            this._grp = { 1: null, 2: null, O: null };
            this._gHeader = {};
            this._buildKodHeader();
            this._buildGroupHeader(1, "Grup 1");
            this._buildGroupHeader(2, "Grup 2");
            this._buildDescHeader();
            this._initPopup();
            this._initGroupPopup();
        }

        setGroup1Filter(values) { this._setGroup(1, values); }
        setGroup2Filter(values) { this._setGroup(2, values); }
        setCostElementFilter(values) { this._setGroup("O", values); }
        getCostElementFilter() { return this._groupText("O"); }

        setMeasure(measure) {
            if (MEASURES.indexOf(measure) < 0) return;
            this._measEl.value = measure;
            if (measure === this._measure) return;
            this._measure = measure;
            this._resetChildren();
            this._applyFilter();
        }

        getMeasure() {
            return this._measure;
        }

        _mi() {
            return MEASURES.indexOf(this._measure);
        }

        _resetChildren() {
            this._agg = new Map();
            this._childCache = new Map();
            this._aggFull = false;
        }

        _valueLabel(level, v) {
            return level === "O" ? v : groupLabel(v);
        }

        _parseGroup(level, values) {
            const list = values instanceof Set ? Array.from(values)
                : typeof values === "string" ? (values.trim() ? values.split(";").map(s => s.trim()) : null)
                : Array.isArray(values) ? values : null;
            return list && list.length ? new Set(list.map(v => v === "(boş)" ? "" : v)) : null;
        }

        _groupText(level) {
            const g = this._grp[level];
            return g ? Array.from(g).map(v => this._valueLabel(level, v)).join(";") : "";
        }

        _setGroup(level, values, silent) {
            this._grp[level] = this._parseGroup(level, values);
            this._updateGroupButton(level);
            if (silent) return;
            if (level === "O") this._reload(false);
            else this._applyFilter();
        }

        _updateGroupButton(level) {
            const g = this._grp[level];
            const pre = level === "O" ? "Masraf: " : "";
            const btn = this._gHeader[level].btn;
            btn.textContent = pre + (!g ? "Tümü" : g.size === 1 ? this._valueLabel(level, Array.from(g)[0]) : `${g.size} seçili`) + " ▾";
            btn.title = g ? this._groupText(level) : "";
            btn.classList.toggle("on", !!g);
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            const c = changedProperties;
            if ("materialFilter" in c) {
                this._matFilter = splitList(this.materialFilter).join("; ");
                this._kodInput.value = this._matFilter;
            }
            if ("componentFilter" in c) this._setCompFilter(this.componentFilter || "", true);
            if ("materialType" in c) {
                this._types = parseTypes(this.materialType) || new Set(["M", "Y"]);
                this._updateTypeButton();
            }
            if ("costElementFilter" in c) this._setGroup("O", this.costElementFilter || "", true);
            if ("measure" in c && MEASURES.indexOf(this.measure) >= 0) {
                this._measEl.value = this.measure;
                if (this.measure !== this._measure) {
                    this._measure = this.measure;
                    this._resetChildren();
                }
            }
            if (["providerId", "version", "parameters", "companyCode", "costElementFilter"].some(k => k in c)) {
                this._scheduleReload();
            } else if (["materialFilter", "componentFilter", "materialType", "measure"].some(k => k in c)) {
                this._refreshUsed();
            }
        }

        _scheduleReload() {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => { if (!this._reload(false)) this._refreshUsed(); }, 150);
        }

        setMaterialType(type) {
            this._types = parseTypes(type) || new Set(["M", "Y"]);
            this._applyFilter();
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

        setComponentFilter(filter) {
            this._setCompFilter(filter);
        }

        getComponentFilter() {
            return this._compFilter;
        }

        _setCompFilter(text, silent) {
            this._compFilter = splitList(text).join("; ");
            this._compMatch = matcher(this._compFilter);
            this._compInput.value = this._compFilter;
            this._compInput.classList.toggle("on", !!this._compFilter);
            if (!silent) this._refreshUsed();
        }

        refresh() {
            return this._reload(true);
        }

        _loadParams() {
            let version = memberId(this.version);
            if (version && version.indexOf(".") < 0) version = "public." + version;
            const companies = splitList(this.companyCode).map(memberId).filter(Boolean).sort();
            const params = splitList(this.parameters || DEFAULT_PARAMS);
            const sig = JSON.stringify([(this.providerId || "").trim(), version, params, companies, this._groupText("O")]);
            return { version, companies, params, sig };
        }

        _reload(force) {
            const p = this._loadParams();
            if (!force && p.sig === this._loadSig) return false;
            this._loadSig = p.sig;
            this._doReload(p);
            return true;
        }

        async _doReload({ version, companies, params }) {
            if (this._abort) this._abort.abort();
            this._abort = new AbortController();
            const token = ++this._token;
            this._allIds = [];
            this._ids = [];
            this._matVals = null;
            this._matValsPromise = null;
            this._nz = null;
            this._resetChildren();
            this._used = null;
            this._pairsPromise = null;
            this._attrsReady = false;
            this._masterPromise = null;
            this._pid = (this.providerId || "").trim();
            this._params = params;

            if (!this._pid || !version || !params.length) {
                this._setStatus("Builder panelinden model, versiyon ve parametreleri girin.");
                return;
            }
            const mos = this._grp.O;
            this._listFilter = `Version eq '${q(version)}'` + (companies.length ? ` and ${orEq("ZSIRKET_KODU", companies)}` : "") + ` and ${orEq("ZPARAMETRE", params)}`;
            this._baseFilter = this._listFilter + (mos ? ` and ${orEq("ZMASRAF_OGESI", Array.from(mos))}` : "");
            const all = MEASURES.join(",");
            this._setStatus("Malzeme listesi yükleniyor…");

            try {
                const [, dateRows, pairRows, listRows, paramRows] = await Promise.all([
                    loadScript(TABULATOR_JS),
                    this._get("FactDataAggregation", { $select: "Date," + all, $filter: this._baseFilter }),
                    this._get("FactDataAggregation", { $select: "ZMALZEME,ZBILESEN," + all, $filter: this._baseFilter }),
                    this._get("FactDataAggregation", { $select: "ZMASRAF_OGESI," + all, $filter: this._listFilter }),
                    this._get("ZPARAMETREMaster", { $select: "ID,Description", $filter: orEq("ID", params) }).catch(() => []),
                    this._loadMoDescriptions()
                ]);
                if (token !== this._token) return;
                this._paramDesc = new Map(paramRows.filter(r => r.Description).map(r => [r.ID, r.Description]));
                const dates = dateRows.map(r => r.Date).filter(d => d && d !== NONE).sort();
                const mats = new Set();
                const parents = new Set();
                const comps = new Set();
                pairRows.forEach(r => {
                    if (!r.ZMALZEME || r.ZMALZEME === NONE) return;
                    mats.add(r.ZMALZEME);
                    if (r.ZBILESEN && r.ZBILESEN !== NONE) { parents.add(r.ZMALZEME); comps.add(r.ZBILESEN); }
                });
                this._moIds = Array.from(new Set(listRows.map(r => r.ZMASRAF_OGESI || NONE))).sort(cmpCode);
                if (!dates.length || !mats.size) {
                    this._destroyTable();
                    this._setStatus(`${version}${companies.length ? " / " + companies.join(",") : ""} için bu seçimle veri yok.`);
                    return;
                }
                this._allIds = Array.from(mats).sort(cmpCode);
                this._allIndex = new Map(this._allIds.map((id, i) => [id, i]));
                this._parentSet = parents;
                this._compSet = comps;
                this._compIds = Array.from(comps).sort(cmpCode);
                this._compIndex = new Map(this._compIds.map((id, i) => [id, i]));
                this._ids = this._filteredIds();
                this._buildTable(dates);
                this._matValsPromise = this._loadMatVals(dates, token);
                this._masterPromise = Promise.all([
                    this._loadMasterRanges("ZMALZEME", this._allIds, token),
                    this._loadMasterRanges("ZBILESEN", this._compIds, token)
                ]).then(() => {
                    if (token !== this._token) return;
                    this._attrsReady = true;
                    this._refreshDescs();
                }, () => {});
                if (this._compMatch) this._refreshUsed();
            } catch (e) {
                if (token !== this._token) return;
                this._loadSig = null;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        async _loadMatVals(dates, token) {
            const vals = MEASURES.map(() => new Map());
            try {
                await runPool(dates.map(d => async () => {
                    const rows = await this._get("FactDataAggregation", { $select: "ZMALZEME,ZPARAMETRE," + MEASURES.join(","), $filter: `${this._baseFilter} and Date eq '${q(d)}'` });
                    if (token !== this._token) return;
                    rows.forEach(r => {
                        const f = fieldOf(d, r.ZPARAMETRE);
                        for (let i = 0; i < MEASURES.length; i++) {
                            const x = r[MEASURES[i]];
                            if (x === null || x === undefined) continue;
                            let o = vals[i].get(r.ZMALZEME);
                            if (!o) vals[i].set(r.ZMALZEME, o = {});
                            o[f] = (o[f] || 0) + x;
                        }
                    });
                }), 8);
            } catch (e) {
                if (token === this._token && !(e && e.name === "AbortError")) this._setStatus("Malzeme değerleri alınamadı: " + errText(e), true);
                return;
            }
            if (token !== this._token) return;
            this._matVals = vals;
            if (!this._table) return;
            const nz = this._nzInfo();
            if (this._ids.some(id => !nz.ids.has(id))) {
                this._applyFilter(true);
                return;
            }
            this._applyCols();
            const empty = Object.fromEntries(this._valueFields.map(f => [f, null]));
            await this._table.updateData([this._totalRow()].concat(this._ids.map(id => Object.assign({ key: `M${id}`, _wait: false }, empty, this._mVals(id)))));
            this._updateStatus();
        }

        _pairsOf() {
            if (!this._pairsPromise) {
                this._pairsPromise = this._get("FactDataAggregation", {
                    $select: "ZMALZEME,ZMASRAF_OGESI,ZBILESEN," + MEASURES.join(","),
                    $filter: this._baseFilter + " and ZBILESEN ne '#'"
                }).then(rows => {
                    const ups = new Map();
                    rows.forEach(r => {
                        let up = ups.get(r.ZMASRAF_OGESI);
                        if (!up) ups.set(r.ZMASRAF_OGESI, up = new Map());
                        if (!up.has(r.ZBILESEN)) up.set(r.ZBILESEN, []);
                        up.get(r.ZBILESEN).push(r.ZMALZEME);
                    });
                    return ups;
                });
                this._pairsPromise.catch(() => { this._pairsPromise = null; });
            }
            return this._pairsPromise;
        }

        async _refreshUsed() {
            const token = this._token;
            const match = this._compMatch;
            this._used = null;
            this._applyFilter();
            if (!match || !this._table) return;
            this._setStatus("Bileşeni kullanan malzemeler bulunuyor…");
            try {
                const ups = await this._pairsOf();
                if (token !== this._token || match !== this._compMatch) return;
                const byMo = new Map();
                const any = new Set();
                ups.forEach((up, mo) => {
                    const set = new Set();
                    const stack = Array.from(up.keys()).filter(match);
                    while (stack.length) {
                        (up.get(stack.pop()) || []).forEach(p => {
                            if (!set.has(p)) { set.add(p); any.add(p); stack.push(p); }
                        });
                    }
                    byMo.set(mo, set);
                });
                this._used = { byMo, any };
                this._applyFilter();
            } catch (e) {
                if (token === this._token && !(e && e.name === "AbortError")) this._setStatus("Bileşen kullanımı alınamadı: " + errText(e), true);
            }
        }

        _typeOf(id) {
            return this._parentSet.has(id) ? (this._compSet.has(id) ? "Y" : "M") : "H";
        }

        _filteredIds() {
            const m = matcher(this._matFilter);
            const ty = this._types;
            const t = ty.size < 3;
            const g1 = this._attrsReady ? this._grp[1] : null;
            const g2 = this._attrsReady ? this._grp[2] : null;
            const attr = this._attr.ZMALZEME;
            const u = this._compMatch ? (this._used ? this._used.any : EMPTY_SET) : null;
            const live = this._liveIds();
            if (!m && !t && !g1 && !g2 && !u) return live.slice();
            return live.filter(id => (!m || m(id)) && (!u || u.has(id)) &&
                (!t || ty.has(this._typeOf(id))) &&
                (!g1 || g1.has((attr.get(id) || {}).g1 || "")) &&
                (!g2 || g2.has((attr.get(id) || {}).g2 || "")));
        }
        async _loadMasterRanges(dim, ids, token) {
            const want = new Set(ids);
            // sorgu başı gecikme satır sayısından pahalı: en büyük boşluklardan 6 aralığa böl, hepsi paralel
            const gap = (a, b) => /^\d+$/.test(a) && /^\d+$/.test(b) && a.length === b.length ? Number(b) - Number(a) : Infinity;
            const cuts = ids.slice(1).map((id, i) => [gap(ids[i], id), i + 1]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(c => c[1]).sort((a, b) => a - b);
            const segs = [];
            [0].concat(cuts).forEach((s, i, arr) => { const e = i + 1 < arr.length ? arr[i + 1] : ids.length; if (e > s) segs.push(ids.slice(s, e)); });
            const select = this._attr[dim] ? "ID,Description,MALZ_GRUP1,MALZ_GRUP2" : "ID,Description";
            try {
                await runPool(segs.map(seg => async () => {
                    if (token !== this._token) return;
                    const rows = await this._get(`${dim}Master`, {
                        $select: select,
                        $filter: seg.length === 1 ? `ID eq '${q(seg[0])}'` : `ID ge '${q(seg[0])}' and ID le '${q(seg[seg.length - 1])}'`
                    });
                    rows.forEach(r => { if (want.has(r.ID)) this._storeMaster(dim, r); });
                }), segs.length);
            } finally {
                if (token === this._token) ids.forEach(id => { if (!this._desc[dim].has(id)) this._storeMaster(dim, { ID: id }); });
            }
        }

        _storeMaster(dim, r) {
            this._desc[dim].set(r.ID, r.Description || "");
            if (this._attr[dim]) this._attr[dim].set(r.ID, { g1: r.MALZ_GRUP1 || "", g2: r.MALZ_GRUP2 || "" });
        }

        _attrOf(dim, id) {
            const a = this._attr[dim] && this._attr[dim].get(id);
            return a ? { g1: a.g1, g2: a.g2 } : { g1: null, g2: null };
        }

        async _loadMoDescriptions() {
            if (this._desc.ZMASRAF_OGESI.size) return;
            try {
                const rows = await this._get("ZMASRAF_OGESIMaster", { $select: "ID,Description" });
                rows.forEach(r => this._desc.ZMASRAF_OGESI.set(r.ID, r.Description || ""));
            } catch (e) {
                return;
            }
        }

        _refreshDescs() {
            if (!this._table) return;
            if (this._grp[1] || this._grp[2]) {
                this._applyFilter();
                return;
            }
            const upd = (r) => {
                const d = r.getData();
                if (d._kind !== "M" && d._kind !== "B") return;
                const dim = DIM[d._kind];
                const a = this._attrOf(dim, d._id);
                const desc = this._desc[dim].get(d._id) || "";
                if (desc !== d.desc || a.g1 !== d.g1 || a.g2 !== d.g2) r.update({ desc, g1: a.g1, g2: a.g2 });
            };
            const walk = (rows) => rows.forEach(r => {
                upd(r);
                if (r.getData()._loaded) walk(r.getTreeChildren());
            });
            const top = this._table.getRows().filter(r => r.getData()._kind === "M");
            this._table.updateData(top.map(r => {
                const id = r.getData()._id;
                return Object.assign({ key: `M${id}`, desc: this._desc.ZMALZEME.get(id) || "" }, this._attrOf("ZMALZEME", id));
            })).then(() => walk(top.filter(r => r.getData()._loaded).reduce((a, r) => a.concat(r.getTreeChildren()), [])));
        }

        _setFilter(text) {
            this._matFilter = splitList(text).join("; ");
            this._kodInput.value = this._matFilter;
            this._applyFilter();
        }

        _applyFilter(keepOpen) {
            this._kodInput.classList.toggle("on", !!this._matFilter);
            this._updateTypeButton();
            if (!this._table || !this._allIds.length) return;
            this._ids = this._filteredIds();
            this._applyCols();
            const open = keepOpen ? this._table.getRows().filter(r => r.getData()._kind === "M" && r.isTreeExpanded()).map(r => r.getData().key) : [];
            this._table.replaceData([this._totalRow()].concat(this._ids.map(id => this._mRow(id)))).then(() => open.forEach(k => {
                const r = this._table && this._table.getRow(k);
                if (r) r.treeExpand();
            }));
            this._updateStatus();
        }

        _nzInfo() {
            if (!this._matVals) return null;
            const mi = this._mi();
            if (this._nz && this._nz.mi === mi && this._nz.vals === this._matVals) return this._nz;
            const ids = new Set();
            const fields = new Set();
            this._matVals[mi].forEach((v, id) => {
                const o = this._addTotals(Object.assign({}, v));
                let any = false;
                for (const f in o) if (!isZero(o[f])) { any = true; fields.add(f); }
                if (any) ids.add(id);
            });
            return this._nz = { mi, vals: this._matVals, ids, fields, live: this._allIds.filter(id => ids.has(id)) };
        }

        _liveIds() {
            const nz = this._nzInfo();
            return nz ? nz.live : this._allIds;
        }

        _shownFields() {
            const nz = this._nzInfo();
            return this._valueFields.map((f, i) => i).filter(i => !nz || nz.fields.has(this._valueFields[i]));
        }

        _applyCols() {
            const nz = this._nzInfo();
            if (!this._table || !nz) return;
            this._valueFields.forEach(f => {
                const c = this._table.getColumn(f);
                if (c && c.isVisible() !== nz.fields.has(f)) nz.fields.has(f) ? c.show() : c.hide();
            });
        }

        _totalRow() {
            const wait = !this._matVals;
            const row = { key: "TOTAL", name: "Toplam", type: "", g1: "", g2: "", desc: wait ? null : `${nf.format(this._ids.length)} malzeme`, _kind: "T", _wait: wait };
            this._valueFields.forEach(f => { row[f] = null; });
            if (wait) return row;
            const vals = this._matVals[this._mi()];
            const sums = {};
            this._ids.forEach(id => { const v = vals.get(id); if (v) addInto(sums, v); });
            return Object.assign(row, this._addTotals(sums));
        }

        _addTotals(o) {
            const plan = this._totPlan;
            for (let i = 0; i < plan.length; i++) {
                const parts = plan[i].parts;
                let sum = 0;
                for (let j = 0; j < parts.length; j++) { const v = o[parts[j]]; if (v) sum += v; }
                if (sum) o[plan[i].tot] = sum;
            }
            return o;
        }

        _node(key, kind, id, vals, extra, expandable) {
            const dim = DIM[kind];
            const cache = this._desc[dim];
            const desc = cache.has(id) ? cache.get(id) : kind === "O" ? "" : null;
            const row = Object.assign({ key, name: id, desc, type: TYPE_LABEL[kind], _id: id, _kind: kind }, this._attrOf(dim, id), this._addTotals(Object.assign({}, vals)), extra);
            if (expandable) row._children = [{ key: key + "/…", name: "Yükleniyor…", _kind: "P" }];
            return row;
        }

        _mVals(id) {
            return this._matVals ? this._addTotals(Object.assign({}, this._matVals[this._mi()].get(id))) : {};
        }

        _mRow(id) {
            return this._node(`M${id}`, "M", id, this._mVals(id), { _free: false, _path: [id], _wait: !this._matVals }, true);
        }

        _ownOf(id, mo) {
            const a = this._agg.get(id);
            return a ? a.mos.get(mo) : null;
        }

        _childData(id) {
            if (this._aggFull) return Promise.resolve(this._agg.get(id) || null);
            if (!this._childCache.has(id)) {
                const m = this._measure;
                const cache = this._childCache;
                const p = this._get("FactDataAggregation", {
                    $select: `ZMALZEME,ZMASRAF_OGESI,ZBILESEN,Date,ZPARAMETRE,${m}`,
                    $filter: `${this._baseFilter} and ZMALZEME eq '${q(id)}'`
                }).then(rows => {
                    const agg = new Map();
                    rows.forEach(r => addRec(agg, r, m));
                    finishAgg(agg);
                    const e = agg.get(id) || null;
                    if (cache === this._childCache) this._agg.set(id, e);
                    return e;
                });
                p.catch(() => cache.delete(id));
                cache.set(id, p);
            }
            return this._childCache.get(id);
        }

        _prefetch(row) {
            const d = row.getData();
            if ((d._kind === "M" || d._kind === "B") && !d._loaded && Array.isArray(d._children)) this._childData(d._id).catch(() => {});
        }

        _children(d) {
            const out = [];
            const used = this._used && !d._free ? this._used.byMo : null;
            if (d._kind === "M") {
                const a = this._agg.get(d._id);
                if (!a) return out;
                a.moIds.forEach(mo => {
                    if (used && !(used.get(mo) || EMPTY_SET).has(d._id)) return;
                    const o = a.mos.get(mo);
                    if (!hasVal(o.vals)) return;
                    out.push(this._node(`${d.key}/O${mo}`, "O", mo, o.vals, { _mat: d._id, _mo: mo, _free: d._free, _path: d._path }, o.compIds.length > 0));
                });
                return out;
            }
            const mo = d._mo;
            const src = d._kind === "O" ? this._ownOf(d._mat, mo) : this._ownOf(d._id, mo);
            if (!src) return out;
            let fac = null;
            if (d._kind === "B") {
                fac = {};
                for (const f in src.sum) { const s = src.sum[f]; const r = d[f]; fac[f] = s && r ? r / s : 0; }
            }
            const m = this._compMatch;
            const u = used ? used.get(mo) || EMPTY_SET : null;
            src.compIds.forEach(id => {
                const hit = !!(m && m(id));
                if (u && !hit && !u.has(id)) return;
                const vals = fac ? scaleVals(src.comps.get(id), fac) : src.comps.get(id);
                if (!hasVal(vals)) return;
                const own = this._ownOf(id, mo);
                const known = this._agg.has(id);
                const cyc = d._path.indexOf(id) >= 0;
                const expandable = !cyc && (known ? !!own && own.compIds.length > 0 : this._parentSet.has(id));
                out.push(this._node(`${d.key}/B${id}`, "B", id, vals,
                    { _mo: mo, _free: d._free || hit, _path: d._path.concat(id) }, expandable));
            });
            return out;
        }

        async _expand(row) {
            const d = row.getData();
            if (d._kind === "P" || d._loaded || d._busy) return;
            d._busy = true;
            const token = this._token;
            const cache = this._childCache;
            try {
                if (d._kind !== "O") await this._childData(d._id);
                if (token !== this._token || cache !== this._childCache) return;
                const children = this._children(d);
                await row.update({ _children: children.length ? children : null, _loaded: true, _busy: false });
            } catch (e) {
                d._busy = false;
                if (token !== this._token) return;
                await row.update({ _children: [{ key: d.key + "/!", name: "Hata: " + errText(e), _kind: "P" }] });
            }
        }

        async _loadFull(token, progress) {
            if (this._aggFull) return;
            const m = this._measure;
            const cache = this._childCache;
            const agg = new Map();
            let done = 0;
            await runPool(this._dates.map(d => async () => {
                const rows = await this._get("FactDataAggregation", {
                    $select: `ZMALZEME,ZMASRAF_OGESI,ZBILESEN,Date,ZPARAMETRE,${m}`,
                    $filter: `${this._baseFilter} and Date eq '${q(d)}'`
                });
                if (token !== this._token || cache !== this._childCache) return;
                rows.forEach(r => addRec(agg, r, m));
                progress(++done, this._dates.length);
            }), 4);
            if (token !== this._token) return;
            if (cache !== this._childCache) throw new Error("measure değişti, tekrar deneyin");
            finishAgg(agg);
            this._agg = agg;
            this._aggFull = true;
        }

        async exportExcel() {
            if (this._exporting) return;
            if (!this._table || !this._ids.length) {
                this._setStatus("Aktarılacak veri yok.");
                return;
            }
            this._exporting = true;
            const btn = this._xlsBtn;
            const step = (text) => { btn.textContent = text; };
            btn.disabled = true;
            const token = this._token;
            try {
                const fflate = await import(FFLATE_JS);
                step("Excel: veri yükleniyor…");
                await Promise.all([
                    this._matValsPromise,
                    this._masterPromise,
                    this._loadFull(token, (done, n) => step(`Excel: veri ${done} / ${n} ay`))
                ]);
                if (token !== this._token) return;
                const ids = this._ids.slice();
                const shown = this._shownFields();
                const limit = Math.min(this.exportRows > 0 ? this.exportRows : EXPORT_ROWS, XLSX_MAX_ROWS);
                const head = XLSX_HEAD.concat(shown.map(i => this._valueTitles[i]));
                const cols = head.map((_, i) => colName(i));
                const parts = [];
                let part = null;
                let written = 0;
                for (const cells of this._exportRows(ids, shown.map(i => this._valueFields[i]))) {
                    if (part && part.rows() - 1 >= limit) {
                        parts.push(part.finish());
                        part = null;
                    }
                    if (!part) {
                        part = xlsxPart(fflate, cols);
                        part.head(head);
                    }
                    part.add(cells);
                    if (++written % 5000 === 0) {
                        step(`Excel: ${nf.format(written)} satır`);
                        await tick();
                        if (token !== this._token) return;
                    }
                }
                parts.push(part.finish());
                step("Excel: dosya hazırlanıyor…");
                await tick();
                const base = `USM_TUTAR_${this._loadParams().version.replace(/^public\./, "")}_${this._measure}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
                if (parts.length === 1) {
                    download(new Blob(parts[0], { type: XLSX_MIME }), base + ".xlsx");
                } else {
                    const files = parts.map((data, i) => ({ name: `${base}_${String(i + 1).padStart(2, "0")}.xlsx`, data }));
                    download(new Blob(zipFiles(fflate, files), { type: "application/zip" }), base + ".zip");
                }
                this._setStatus(`Excel: ${nf.format(written)} satır, ${parts.length} dosya indirildi.`);
            } catch (e) {
                if (token === this._token && !(e && e.name === "AbortError")) this._setStatus("Excel aktarılamadı: " + errText(e), true);
            } finally {
                this._exporting = false;
                btn.disabled = false;
                step("Excel'e aktar");
            }
        }

        *_exportRows(ids, fields) {
            const self = this;
            const line = (lvl, top, parent, r) => {
                const dim = DIM[r._kind];
                const a = this._attrOf(dim, r._id);
                const cells = [lvl, top, parent, r._kind === "M" ? "" : r._mo, r._id, this._desc[dim].get(r._id) || "", a.g1, a.g2, TYPE_LABEL[r._kind]];
                for (let i = 0; i < fields.length; i++) {
                    const v = r[fields[i]];
                    cells.push(v !== undefined && v !== null ? Math.round(v * 1e6) / 1e6 : null);
                }
                return cells;
            };
            const walk = function* (r, top, parent, lvl) {
                yield line(lvl, top, parent, r);
                if (!r._children) return;
                const next = r._kind === "O" ? parent : r._id;
                for (const c of self._children(r)) yield* walk(c, top, next, lvl + 1);
            };
            for (const id of ids) yield* walk(this._mRow(id), id, "", 1);
        }

        _setStatus(text, isError) {
            this._statusEl.textContent = text;
            this._statusEl.className = isError ? "error" : "";
        }

        _updateStatus() {
            const all = this._liveIds().length;
            const count = this._ids.length === all
                ? nf.format(all)
                : `${nf.format(this._ids.length)} / ${nf.format(all)}`;
            this._setStatus(`${count} malzeme${this._matVals ? "" : " · değerler yükleniyor…"}`);
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
            box.querySelector("button:not(.tbtn)").addEventListener("click", () => this._openPopup("ZMALZEME"));
            this._kodHeaderEl = el;
        }

        _buildDescHeader() {
            const el = document.createElement("div");
            el.innerHTML = `<div>Açıklama</div><div class="kod-f"><input type="text" placeholder="Bileşen: 11*, 11000001-11009999"><button title="Bileşen çoklu seçim">⋯</button><button class="gbtn mbtn"></button></div>`;
            const box = el.querySelector(".kod-f");
            const moBtn = box.querySelector(".mbtn");
            this._compInput = box.querySelector("input");
            this._compBtn = box.querySelector("button");
            stopEvents(box);
            const apply = () => { if (splitList(this._compInput.value).join("; ") !== this._compFilter) this._setCompFilter(this._compInput.value); };
            this._compInput.addEventListener("keydown", e => {
                if (e.key === "Enter") apply();
                if (e.key === "Escape") { this._compInput.value = this._compFilter; this._compInput.blur(); }
            });
            this._compInput.addEventListener("change", apply);
            this._compBtn.addEventListener("click", () => this._openPopup("ZBILESEN", this._compBtn));
            moBtn.addEventListener("click", () => this._openGroupPopup("O", moBtn));
            this._gHeader.O = { btn: moBtn, title: "Masraf öğesi" };
            this._descHeaderEl = el;
            this._setCompFilter("", true);
            this._updateGroupButton("O");
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
                if (!this._gEdit.size) return;
                close();
                if (this._gLevel === "T") {
                    this.setMaterialType(Array.from(this._gEdit).join(","));
                    return;
                }
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
                this._liveIds().forEach(id => { counts[this._typeOf(id)]++; });
                this._gValues = TYPE_KEYS.map(k => [k, counts[k], TYPE_NAMES[k]]);
                this._gEdit = new Set(this._types);
                this._renderGroupList();
                return;
            }
            if (level === "O") {
                this._gValues = this._moIds.map(v => [v, null, `${v} ${this._desc.ZMASRAF_OGESI.get(v) || ""}`.trim()]);
            } else {
                if (!this._attrsReady) {
                    this._gInfoEl.textContent = "grup bilgileri yükleniyor…";
                    if (this._masterPromise) await this._masterPromise;
                    if (!this._attrsReady || this._gpop.hidden || this._gLevel !== level) return;
                }
                const key = level === 1 ? "g1" : "g2";
                const counts = new Map();
                this._liveIds().forEach(id => {
                    const v = (this._attr.ZMALZEME.get(id) || {})[key] || "";
                    counts.set(v, (counts.get(v) || 0) + 1);
                });
                this._gValues = Array.from(counts.entries()).sort((a, b) => a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0], "tr"));
            }
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
                label.querySelector("span").textContent = n === null || n === undefined ? "" : nf.format(n);
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
                const text = this._sel.filter(s => s.low).map(tokenText).join("; ");
                if (this._popDim === "ZBILESEN") this._setCompFilter(text);
                else this._setFilter(text);
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

        _openPopup(dim, btn) {
            const comp = dim === "ZBILESEN";
            this._popDim = dim;
            this._gpop.hidden = true;
            this._kodInput.value = this._matFilter;
            this._compInput.value = this._compFilter;
            this._root.getElementById("popTitle").textContent = comp ? "Bileşen seçimi" : "Malzeme seçimi";
            this._root.getElementById("popSearchLbl").textContent = comp ? "Bileşen ara" : "Malzeme ara";
            this._searchEl.placeholder = comp ? "örn. 11008335 veya RULMAN" : "örn. 2100253 veya DAVLUMBAZ";
            const wrap = this._root.querySelector(".wrap").getBoundingClientRect();
            this._pop.style.left = btn ? Math.max(8, Math.min(btn.getBoundingClientRect().left - wrap.left, wrap.width - 468)) + "px" : "";
            this._sel = splitList(comp ? this._compFilter : this._matFilter).map(parseToken);
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
            const dim = this._popDim;
            const noun = dim === "ZBILESEN" ? "bileşen" : "malzeme";
            const all = dim === "ZBILESEN" ? this._compIds : this._allIds;
            const index = dim === "ZBILESEN" ? this._compIndex : this._allIndex;
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
                        const upper = term.toLocaleUpperCase("tr-TR");
                        const cache = this._desc[dim];
                        all.forEach(id => {
                            if (found.size >= MAX_HITS) return;
                            const t = cache.get(id);
                            if (t && (t.toLocaleLowerCase("tr-TR").indexOf(lower) >= 0 || t.indexOf(upper) >= 0)) found.add(id);
                        });
                    }
                    hits = Array.from(found).sort((a, b) => index.get(a) - index.get(b));
                    more = codeHits.length > MAX_HITS || hits.length >= MAX_HITS;
                }
                await this._loadDescriptions(dim, hits);
                if (token !== this._searchToken) return;
                this._hits = hits;
                this._renderHits();
                this._hitInfoEl.textContent = hits.length
                    ? `${hits.length} ${noun}${more ? ` (ilk ${MAX_HITS} gösteriliyor, aramayı daraltın)` : ""}`
                    : `Eşleşen ${noun} yok.`;
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
                label.querySelector("span").textContent = this._desc[this._popDim].get(id) || "";
                frag.appendChild(label);
            });
            this._hitsEl.appendChild(frag);
        }

        _buildTable(dates) {
            this._dates = dates;
            this._destroyTable();
            const columns = [
                { title: "Kod", field: "name", width: 260, frozen: true, titleFormatter: () => this._kodHeaderEl },
                { title: "Açıklama", field: "desc", width: 280, frozen: true, formatter: descFormatter, titleFormatter: () => this._descHeaderEl },
                { title: "Grup 1", field: "g1", width: 120, cssClass: "soft", titleFormatter: () => this._gHeader[1].el },
                { title: "Grup 2", field: "g2", width: 170, cssClass: "soft", titleFormatter: () => this._gHeader[2].el },
                { title: "Tür", field: "type", width: 95, cssClass: "soft" }
            ];
            this._valueFields = [];
            this._valueTitles = [];
            this._totPlan = this._params.map(p => ({ tot: fieldOf(TOT, p), parts: dates.map(d => fieldOf(d, p)) }));
            [TOT].concat(dates).forEach(d => {
                columns.push({
                    title: d === TOT ? "Toplam" : fmtDate(d),
                    cssClass: "pgroup",
                    columns: this._params.map((p, i) => {
                        const title = this._paramDesc.get(p) || p;
                        this._valueFields.push(fieldOf(d, p));
                        this._valueTitles.push(`${d === TOT ? "Toplam" : fmtDate(d)} ${title}`);
                        return {
                            title, headerTooltip: p, headerWordWrap: true, field: fieldOf(d, p), width: 112,
                            hozAlign: "right", formatter: numFormatter, accessorClipboard: numCopy, cssClass: i === 0 ? "pstart" : ""
                        };
                    })
                });
            });

            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: [this._totalRow()].concat(this._ids.map(id => this._mRow(id))),
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
                    const d = row.getData();
                    const k = d._kind;
                    row.getElement().classList.toggle("leaf", !(Array.isArray(d._children) && d._children.length));
                    if (k === "O") row.getElement().classList.add("row-mo");
                    if (k === "P") row.getElement().classList.add("row-placeholder");
                    if (k === "T") row.getElement().classList.add("row-total");
                }
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
    }

    customElements.define("custom-usm-tutar", UsmTutar);
})();
