(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js";
    const FFLATE_JS = "https://unpkg.com/fflate@0.8.2/esm/browser.js";
    const MAX_HITS = 200;
    const SEL_ROWS_MAX = 50;
    const NO_MASTER = new Set(["Date", "Version", "ZCURRENCY"]);
    const DIM_LABEL = { Date: "Dönem", Version: "Versiyon" };
    const DESC_ONLY = new Set(["ZPARAMETRE"]);
    const SCRIPT_ONLY = [["Version", "setVersion"], ["ZSIRKET_KODU", "setCompanyCode"]];
    const CUR_FREE = new Set(["ZORAN", "ZMIKTAR"]);
    const SUP_PARAMS = new Set(["USM0008"]);
    const TUTAR_MEASURES = ["ZTUTAR", "ZTUTAR_EUR", "ZTUTAR_USD", "ZTUTAR_TRY"];
    const SEP = "\u0001";
    const ACTUAL = "public.Actual";
    const BLOCK = 200;
    const ROW_H = 26;
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
    const chunks = (arr, n) => {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    };
    const and = (a, b) => a && b ? `${a} and ${b}` : a || b;
    const nzF = (ms) => "(" + ms.map(m => `${m} gt 0 or ${m} lt 0`).join(" or ") + ")";
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
        const d = cell.getData();
        return d._total || d._wait ? "" : "–";
    };
    const nonZero = (v) => v !== null && v !== undefined && Math.abs(v) >= 1e-9;
    const errText = (e) => e && e.message ? e.message : String(e);

    const cmpCode = (a, b) => {
        if (/^\d+$/.test(a) && /^\d+$/.test(b) && a.length !== b.length) return a.length - b.length;
        return a < b ? -1 : a > b ? 1 : 0;
    };
    const BLANK = "(boş)";
    const quoteId = (id) => id === "" ? BLANK : /[*?;,!"]/.test(id) ? `"${id}"` : id;
    const parseToken = (tok) => {
        if (/^!?"/.test(tok)) return { low: tok, high: "" };
        const m = tok.indexOf("*") < 0 ? tok.match(/^(.+?)\s*-\s*(.+)$/) : null;
        return m ? { low: m[1].trim(), high: m[2].trim() } : { low: tok, high: "" };
    };
    const tokenText = (s) => s.high ? `${s.low}-${s.high}` : s.low;
    // ";" ile token: kod, 11*, alt-üst, "tırnaklı tam değer", (boş); başında ! = hariç
    const matcher = (text) => {
        const sets = { p: new Set(), n: new Set() };
        const fns = { p: [], n: [] };
        splitList(text).forEach(tok => {
            const k = tok[0] === "!" ? "n" : "p";
            const raw = k === "n" ? tok.slice(1).trim() : tok;
            const q = raw.match(/^"(.*)"$/);
            if (q) { sets[k].add(q[1]); return; }
            const s = parseToken(raw);
            if (!s.low) return;
            if (s.high) fns[k].push(id => id === raw || (cmpCode(id, s.low) >= 0 && cmpCode(id, s.high) <= 0));
            else if (/[*?]/.test(s.low)) {
                const re = new RegExp("^" + s.low.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
                fns[k].push(id => re.test(id));
            } else sets[k].add(s.low === BLANK ? "" : s.low);
        });
        const hasP = sets.p.size > 0 || fns.p.length > 0;
        const hasN = sets.n.size > 0 || fns.n.length > 0;
        if (!hasP && !hasN) return null;
        const hit = (k, id) => sets[k].has(id) || fns[k].some(f => f(id));
        return id => (!hasP || hit("p", id)) && !(hasN && hit("n", id));
    };
    const stopEvents = (el) => ["mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "contextmenu"]
        .forEach(ev => el.addEventListener(ev, e => e.stopPropagation()));

    const CELL_MAX = 3000;
    const hashOf = (dim) => dim === "Date" ? "000000" : "#";
    const parseNum = (t) => {
        let s = String(t).trim().replace(/\s/g, "");
        if (!s) return null;
        if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
        else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
        const n = Number(s);
        return isFinite(n) ? n : NaN;
    };
    const months = (s, e) => {
        const out = [];
        for (let y = +s.slice(0, 4), m = +s.slice(4); y * 100 + m <= +e; m === 12 ? (y++, m = 1) : m++) out.push(String(y * 100 + m));
        return out;
    };
    const product = (lists) => lists.reduce((acc, l) => [].concat(...acc.map(a => l.map(v => a.concat([v])))), [[]]);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; }
            .bar { flex: 0 0 auto; display: flex; align-items: center; }
            #status { flex: 1 1 auto; font-size: 11px; color: #9a9a9a; padding: 4px 6px; }
            #mSelWrap { flex: 0 0 auto; display: flex; }
            #mSelWrap[hidden] { display: none; }
            #mSel { margin: 2px 0 2px 6px; font: 11px Arial, sans-serif; padding: 1px 2px; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; }
            #mSel:focus { outline: 1px solid #ff0000; outline-offset: 0; border-color: #ff0000; }
            #xls { flex: 0 0 auto; margin: 2px 6px; padding: 1px 8px; font: 11px Arial, sans-serif; cursor: pointer; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; }
            #xls:hover:not(:disabled) { background: #ffe8e8; }
            #xls:disabled { color: #999; cursor: default; }
            #colSels { flex: 0 0 auto; display: flex; gap: 4px; }
            .cbtn { margin: 2px 0; padding: 1px 8px; font: 11px Arial, sans-serif; cursor: pointer; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; white-space: nowrap; }
            .cbtn:hover { background: #ffe8e8; }
            .cbtn.on { border-color: #ff0000; background: #ffe8e8; }
            .bud { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; margin-left: 6px; font: 10px Arial, sans-serif; color: #b0b0b0; cursor: pointer; }
            .bud input { width: 11px; height: 11px; margin: 0; }
            .bud.off { opacity: .45; cursor: default; }
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
            .tabulator-row .tabulator-cell.act, .tabulator .tabulator-header .tabulator-col.act { background-color: #f3f3f3 !important; }
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
            .hit-act { display: flex; gap: 4px; margin-top: 4px; }
            .hit-act button { padding: 1px 8px; }
            .sel-more { color: #666; padding: 2px 0; }
            .pop-f { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid #eee; }
            .pop-f .sp { flex: 1; }
            .pop-f button { padding: 3px 12px; }
            .pop-f .primary { background: #ff0000; border-color: #ff0000; color: #fff; }
            .pop-f .primary:hover { background: #ff3333; }
            #save, #addR { flex: 0 0 auto; margin: 2px 0 2px 6px; padding: 1px 8px; font: 11px Arial, sans-serif; cursor: pointer; border: 1px solid #dadada; background: #fff; border-radius: 3px; color: #444; }
            #addR { margin-left: 0; }
            #save:disabled { color: #999; cursor: default; }
            #save.on { background: #ff0000; border-color: #ff0000; color: #fff; }
            #addR:hover { background: #ffe8e8; }
            .tabulator-row .tabulator-cell.dirty { background-color: #fff3c4 !important; }
            .tabulator-row .tabulator-cell.tabulator-editing { padding: 0; }
            .ced { width: 100%; height: 100%; box-sizing: border-box; border: 1px solid #ff0000; outline: 0; font: 12px Arial, sans-serif; text-align: right; padding: 0 7px; }
            .ced.txt { text-align: left; }
        </style>
        <div class="wrap">
            <div class="bar"><button id="save" disabled>Kaydet</button><button id="xls">Excel'e aktar</button><button id="addR" title="Listede olmayan kombinasyon için boş satır">+ Satır</button><div id="status">Yükleniyor…</div></div>
            <div id="table"></div>
            <div id="pop" class="pop" hidden>
                <div class="pop-h"><span id="popTitle"></span><button class="x" id="popClose" title="Kapat">×</button></div>
                <div class="pop-b">
                    <div class="pop-sec">Seçimler <small>(tek kod, 11* veya alt – üst aralık)</small></div>
                    <div id="selRows" class="sel-rows"></div>
                    <button id="addRow" class="link">+ satır</button>
                    <div class="pop-sec"><span id="popSearchLbl"></span> <small>(kod veya tanım; tik kaldır = hariç tut)</small></div>
                    <input id="search" type="text" placeholder="kod veya tanım">
                    <div class="hit-act"><button id="hitAll">Tümünü seç</button><button id="hitNone">Tümünü kaldır</button></div>
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

    class SacGiris extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._root = shadowRoot;
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._tableEl.addEventListener("keydown", (e) => this._onKey(e), true);
            this._tableEl.addEventListener("paste", (e) => {
                if (e.target.closest("input,textarea,select")) return;
                const text = (e.clipboardData || window.clipboardData).getData("text");
                if (!text) return;
                e.preventDefault();
                e.stopPropagation();
                this._paste(text);
            });
            this._xlsBtn = shadowRoot.getElementById("xls");
            this._xlsBtn.addEventListener("click", () => this.exportExcel());
            this._saveBtn = shadowRoot.getElementById("save");
            this._saveBtn.addEventListener("click", () => this.save());
            shadowRoot.getElementById("addR").addEventListener("click", () => this._addRow());
            this._table = null;
            this._token = 0;
            this._sel = new Map();
            this._match = new Map();
            this._override = new Map();
            this._inputs = new Map();
            this._desc = new Map();
            this._ids = new Map();
            this._dirty = new Map();
            this._byKey = new Map();
            this._metaCache = new Map();
            this._rowDims = [];
            this._rows = [];
            this._newRows = [];
            this._shown = [];
            this._leaves = [];
            this._vFields = [];
            this._newSeq = 0;
            this._initPopup();
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if (["providerId", "rowDims", "colDims", "filters", "measures"].some(k => k in changedProperties)) this._scheduleReload();
            else if ("freezeCols" in changedProperties && this._table) this._buildTable(this._p);
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

        getFilter(dimension) {
            return (this._loadParams().filters.get(String(dimension || "").trim()) || []).join(",");
        }

        setSelection(dimension, values) {
            this._setSel(String(dimension || "").trim(), values);
        }

        getSelection(dimension) {
            return this._sel.get(String(dimension || "").trim()) || "";
        }

        hasChanges() {
            return this._dirty.size > 0;
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
            const filters = parseFilters(this.filters);
            SCRIPT_ONLY.forEach(([d]) => filters.delete(d));
            this._override.forEach((vals, dim) => { if (vals.length) filters.set(dim, vals); else filters.delete(dim); });
            const fl = Array.from(filters.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
            return { pid, rows, cols, measures, filters, sig: JSON.stringify([pid, rows, cols, measures, fl]) };
        }

        _reload(force) {
            const p = this._loadParams();
            if (!force && p.sig === this._loadSig) return false;
            this._loadSig = p.sig;
            this._doReload(p);
            return true;
        }

        _meta() {
            if (!this._metaCache.has(this._pid)) {
                const pr = fetch(`${window.location.origin}/api/v1/dataimport/models/${encodeURIComponent(this._pid)}/metadata`, { credentials: "include", headers: { Accept: "application/json" } })
                    .then(async r => {
                        if (!r.ok) throw new Error(`Model metadata okunamadı: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
                        const f = (await r.json()).factData;
                        const keys = f.keys;
                        return { keys, measures: f.columns.map(c => c.columnName).filter(c => keys.indexOf(c) < 0) };
                    });
                this._metaCache.set(this._pid, pr);
                pr.catch(() => this._metaCache.delete(this._pid));
            }
            return this._metaCache.get(this._pid);
        }

        async _doReload(p) {
            if (this._abort) this._abort.abort();
            this._abort = new AbortController();
            const token = ++this._token;
            this._pid = p.pid;
            this._pop.hidden = true;
            this._full = false;
            this._canWrite = false;
            this._dirty = new Map();
            this._newRows = [];
            this._syncSave();
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
            const t0 = Date.now();
            this._setStatus("Yükleniyor…");
            try {
                const [, meta] = await Promise.all([loadScript(TABULATOR_JS), this._meta()]);
                if (token !== this._token) return;
                const keys = meta.keys;
                const mIds = Array.from(new Set(p.measures.map(m => m.id)));
                const attrFilters = parseItems(Array.from(p.filters.keys()).filter(d => d.indexOf(".") > 0).join(","));
                const items = p.rows.concat(p.cols);
                const plainRows = p.rows.filter(d => !d.attr);
                const used = new Set(items.filter(d => !d.attr).map(d => d.id));
                const bad = Array.from(new Set(items.concat(attrFilters).map(d => d.base).filter(d => keys.indexOf(d) < 0)));
                if (bad.length) throw new Error(`Modelde olmayan boyut: ${bad.join(", ")}`);
                const badM = mIds.filter(m => meta.measures.indexOf(m) < 0);
                if (badM.length) throw new Error(`Modelde olmayan measure: ${badM.join(", ")}`);
                if (p.cols.some(d => d.attr)) throw new Error("Sütunda özellik (BOYUT.ÖZELLİK) kullanılamaz.");
                const lone = items.concat(attrFilters).filter(d => d.attr && !plainRows.some(r => r.id === d.base)).map(d => d.id);
                if (lone.length) throw new Error(`Özellik için boyutun kendisi de satırda olmalı: ${lone.join(", ")}`);
                if (!plainRows.length) throw new Error("Satırda en az bir boyut olmalı.");
                Array.from(p.filters.keys()).forEach(d => {
                    if (d.indexOf(".") > 0 || keys.indexOf(d) >= 0) return;
                    if (SCRIPT_ONLY.some(([s]) => s === d)) p.filters.delete(d);
                    else throw new Error(`Modelde olmayan filtre boyutu: ${d}`);
                });

                // satır/sütun/filtrede olmayan her boyut = atanmamış (#)
                const fixed = new Map();
                const multi = [];
                const clauses = [];
                keys.forEach(k => {
                    const f = p.filters.get(k);
                    if (f) clauses.push(orEq(k, f));
                    if (used.has(k)) return;
                    if (!f) { fixed.set(k, hashOf(k)); clauses.push(`${k} eq '${hashOf(k)}'`); }
                    else if (f.length === 1) fixed.set(k, f[0]);
                    else multi.push(k);
                });
                let dateList = null;
                if (used.has("Date") && !p.filters.has("Date") && fixed.has("Version")) {
                    const vm = await this._get("VersionMaster", {}).catch(() => []);
                    if (token !== this._token) return;
                    const b = vm.find(r => r.ID === fixed.get("Version"));
                    if (b && b.BUD_START && b.BUD_END) {
                        dateList = months(b.BUD_START, b.BUD_END);
                        clauses.push(`Date ge '${q(b.BUD_START)}' and Date le '${q(b.BUD_END)}'`);
                    }
                }
                if (keys.indexOf("ZMALZEME") >= 0) clauses.push("ZMALZEME ne 'KOMB' and ZMALZEME ne 'KOMBYENI'");
                const filter = clauses.join(" and ");

                const dims = Array.from(new Set(items.map(d => d.base)));
                const attrs = new Map();
                items.concat(attrFilters).forEach(d => {
                    if (!d.attr) return;
                    if (!attrs.has(d.base)) attrs.set(d.base, new Set());
                    attrs.get(d.base).add(d.attr);
                });
                const masterDims = dims.filter(d => !NO_MASTER.has(d) || attrs.has(d));
                const [masters, recs] = await Promise.all([
                    Promise.all(masterDims.map(d => this._get(`${d}Master`, { $select: ["ID", "Description"].concat(Array.from(attrs.get(d) || [])).join(",") })
                        .catch(e => { if (attrs.has(d)) throw new Error(`${d} özellikleri okunamadı (${Array.from(attrs.get(d)).join(", ")}): ${errText(e)}`); return []; }))),
                    this._get("FactDataAggregation", { $select: dims.concat(mIds).join(","), $filter: filter })
                ]);
                if (token !== this._token) return;
                this._desc = new Map();
                this._attrs = new Map();
                this._ids = new Map();
                masterDims.forEach((d, i) => {
                    const m = new Map();
                    masters[i].forEach(r => { if (r.Description) m.set(r.ID, r.Description); });
                    if (m.size && !NO_MASTER.has(d)) this._desc.set(d, m);
                    if (masters[i].length) this._ids.set(d, masters[i].map(r => r.ID));
                    if (attrs.has(d)) this._attrs.set(d, new Map(masters[i].map(r => [r.ID, r])));
                });

                const inData = (d) => Array.from(new Set(recs.map(r => r[d]).filter(v => v !== undefined && v !== null))).sort(cmpCode);
                const colLists = p.cols.map(d => p.filters.get(d.id) || (d.id === "Date" && dateList) || inData(d.id));
                const emptyCol = p.cols.filter((d, i) => !colLists[i].length).map(d => d.id);
                if (emptyCol.length) throw new Error(`Sütun değeri yok; filtre verin: ${emptyCol.join(", ")}`);
                if (colLists.reduce((n, l) => n * l.length, 1) > CELL_MAX) throw new Error("Sütun sayısı çok fazla; filtreyi daraltın.");
                this._cols = product(colLists).map((vals, ci) => ({ ci, vals }));
                const colIndex = new Map(this._cols.map(c => [c.vals.join(SEP), c.ci]));

                this._p = p;
                this._af = attrFilters.map(d => [d, new Set(p.filters.get(d.id))]);
                this._rowDims = p.rows;
                this._plainRows = plainRows;
                this._mIds = p.measures.map(m => m.id);
                this._allM = meta.measures;
                this._fixed = fixed;
                this._filter = filter;
                this._byKey = new Map();
                recs.forEach(r => {
                    const ci = colIndex.get(p.cols.map(d => String(r[d.id] === undefined || r[d.id] === null ? "" : r[d.id])).join(SEP));
                    if (ci === undefined) return;
                    const row = this._rowFor(plainRows.map(d => String(r[d.id] === undefined || r[d.id] === null ? "" : r[d.id])));
                    if (!row) return;
                    this._mIds.forEach((m, mi) => {
                        const x = r[m];
                        if (x === null || x === undefined || x === "") return;
                        const f = `v${ci}_${mi}`;
                        row[f] = (row[f] || 0) + Number(x);
                    });
                });
                // veri olmayan kombinasyonlar: filtre değerleri ya da anaveri
                const rowLists = plainRows.map(d => p.filters.get(d.id) || (d.id === "Date" && dateList) || (this._ids.get(d.id) || []).filter(v => v !== "#"));
                if (rowLists.every(l => l.length) && rowLists.reduce((n, l) => n * l.length, 1) <= CELL_MAX) product(rowLists).forEach(vals => this._rowFor(vals));
                this._rows = Array.from(this._byKey.values());
                this._rows.sort((a, b) => {
                    for (let i = 0; i < p.rows.length; i++) {
                        const c = cmpCode(a["r" + i], b["r" + i]);
                        if (c) return c;
                    }
                    return 0;
                });
                this._rows.forEach(r => this._rowTotals(r));
                this._dimIds = new Map();
                this._canWrite = !multi.length;
                this._roWhy = multi.length ? `Salt okunur: ${multi.join(", ")} filtresinde tek değer olmalı (ya da satır/sütuna alın)` : "";
                this._full = true;
                this._buildTable(p);
                this._loadMs = Date.now() - t0;
                this._updateStatus();
            } catch (e) {
                if (token !== this._token || (e && e.name === "AbortError")) return;
                this._loadSig = null;
                this._destroyTable();
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        _fillRow(row, vals) {
            const rec = {};
            this._plainRows.forEach((d, j) => { rec[d.id] = vals[j]; });
            this._rowDims.forEach((d, i) => {
                const v = this._valueOf(d, rec);
                row["r" + i] = v;
                const m = this._desc.get(d.id);
                if (m) row[`r${i}d`] = m.get(v) || "";
            });
            return rec;
        }

        _rowFor(vals) {
            const key = vals.join(SEP);
            let row = this._byKey.get(key);
            if (row) return row;
            row = { key };
            const rec = this._fillRow(row, vals);
            for (let k = 0; k < this._af.length; k++) if (!this._af[k][1].has(this._valueOf(this._af[k][0], rec))) return null;
            this._byKey.set(key, row);
            return row;
        }

        _rowTotals(row) {
            if (!this._p.cols.length) return;
            this._mIds.forEach((m, mi) => {
                let t = null;
                this._cols.forEach(c => {
                    const v = row[`v${c.ci}_${mi}`];
                    if (v !== undefined && v !== null) t = (t || 0) + v;
                });
                row["t_" + mi] = t;
            });
        }

        _label(dim, v) {
            const d = this._desc.get(dim);
            const desc = d && d.get(v);
            if (!v) return desc || "(boş)";
            if (dim === "Version") return v.replace(/^public[.]/, "");
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

        _columnDefs(p) {
            const colIds = p.cols.map(d => d.id);
            const ms = p.measures;
            const nc = colIds.length;
            this._leaves = [];
            this._vFields = [];
            const fmt = (cell) => {
                const d = cell.getData();
                cell.getElement().classList.toggle("dirty", this._dirty.has(d.key + SEP + cell.getField()));
                return numFormatter(cell);
            };
            const ed = this._editor(true);
            const leaf = (c, mi, title) => {
                const path = c.vals.map((v, i) => this._label(colIds[i], v));
                if (ms.length > 1 || !nc) path.push(ms[mi].label);
                const field = `v${c.ci}_${mi}`;
                this._leaves.push({ field, title: path.join(" / ") });
                this._vFields.push(field);
                return {
                    title, field, headerTooltip: c.vals.concat([ms[mi].id]).join(" / "), headerWordWrap: true, width: 105, hozAlign: "right",
                    formatter: fmt, accessorClipboard: numCopy, editor: ed, editable: (cell) => this._isEditable(cell)
                };
            };
            const build = (list, si) => {
                if (si === nc) return ms.map((m, k) => leaf(list[0], k, m.label));
                const groups = [];
                list.forEach(c => {
                    const g = groups[groups.length - 1];
                    if (g && g.v === c.vals[si]) g.list.push(c);
                    else groups.push({ v: c.vals[si], list: [c] });
                });
                return groups.map(g => {
                    const title = this._label(colIds[si], g.v);
                    if (si === nc - 1 && ms.length === 1) return leaf(g.list[0], 0, title);
                    return { title, headerTooltip: g.v, cssClass: "pgroup", columns: build(g.list, si + 1) };
                });
            };
            const defs = build(this._cols, 0);
            if (nc) {
                const tot = ms.map((m, mi) => ({
                    title: ms.length > 1 ? m.label : "Toplam", field: "t_" + mi, headerTooltip: "Satır toplamı", headerWordWrap: true, width: 115,
                    hozAlign: "right", formatter: numFormatter, accessorClipboard: numCopy, cssClass: "tot"
                }));
                this._leaves.unshift(...ms.map((m, mi) => ({ field: "t_" + mi, title: ms.length > 1 ? `Toplam / ${m.label}` : "Toplam" })));
                defs.unshift(tot.length > 1 ? { title: "Toplam", cssClass: "pgroup", columns: tot } : tot[0]);
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
                    if (v !== undefined && v !== null) row[fields[i]] = (row[fields[i]] || 0) + v;
                }
            });
            return row;
        }

        _applyFilter() {
            this._inputs.forEach((input, dim) => input.classList.toggle("on", this._sel.has(dim)));
            if (!this._table) return;
            this._shown = this._newRows.concat(this._filtered());
            this._table.replaceData([this._totalRow()].concat(this._shown));
            this._updateStatus();
        }

        _columns(p) {
            this._inputs = new Map();
            const columns = [];
            const ed = this._editor(false);
            p.rows.forEach((d, i) => {
                const descOnly = DESC_ONLY.has(d.id) && this._desc.has(d.id);
                columns.push({
                    title: d.label, field: "r" + i, width: 150, titleFormatter: () => this._buildHeader(i, d),
                    formatter: descOnly ? (cell) => cell.getData()[`r${i}d`] || cell.getValue() : undefined,
                    accessorClipboard: descOnly ? (v, data) => data[`r${i}d`] || v : textCopy,
                    editor: d.attr ? undefined : ed, editable: (cell) => this._isEditable(cell)
                });
                if (this._twoCols(d.id)) columns.push({ title: d.label + " Tanımı", field: `r${i}d`, width: 230, cssClass: "soft" });
            });
            const fz = parseInt(this.freezeCols, 10);
            const first = this._twoCols(p.rows[0].id) ? 2 : 1;
            columns.forEach((c, k) => { c.frozen = k < (fz > 0 ? fz : first); });
            return columns.concat(this._columnDefs(p));
        }

        _buildTable(p) {
            this._destroyTable();
            const columns = this._columns(p);
            this._shown = this._newRows.concat(this._filtered());
            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: [this._totalRow()].concat(this._shown),
                frozenRows: 1,
                height: "100%",
                rowHeight: 26,
                layout: "fitData",
                columns,
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

        // --- giriş ---

        _rowOf(key) {
            return this._byKey.get(key) || this._newRows.find(r => r.key === key);
        }

        _isEditable(cell) {
            const d = cell.getData();
            const f = cell.getField();
            if (d._total || !this._canWrite || this._saving) return false;
            if (/^v\d+_\d+$/.test(f)) return true;
            const m = f.match(/^r(\d+)$/);
            return !!(m && d._new && !this._rowDims[+m[1]].attr);
        }

        _rangeCells() {
            if (!this._table) return [];
            const out = [];
            const walk = (c) => Array.isArray(c) ? c.forEach(walk) : out.push(c);
            this._table.getRanges().forEach(r => walk(r.getCells()));
            return out;
        }

        _onKey(e) {
            if (e.target.closest("input,textarea,select")) return;
            // Tabulator 6.3.1: Enter editörsüz hücrede çöküyor; düzenlemeyi kendimiz açıyoruz
            const isEnter = e.key === "Enter" || e.key === "F2";
            if (isEnter) e.stopPropagation();
            if (!this._table || e.ctrlKey || e.metaKey || e.altKey) return;
            const cells = this._rangeCells();
            if (!cells.length) return;
            if (isEnter) {
                e.preventDefault();
                if (this._isEditable(cells[0])) cells[0].edit(true);
            } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                const rows = new Set();
                cells.forEach(c => {
                    const row = this._rowOf(c.getData().key);
                    if (row && this._isEditable(c) && /^v/.test(c.getField()) && this._setCell(row, c.getField(), null)) rows.add(row);
                });
                this._flush(rows);
            } else if (e.key.length === 1 && this._isEditable(cells[0]) && (/^r/.test(cells[0].getField()) || /[0-9,.\-]/.test(e.key))) {
                e.preventDefault();
                e.stopPropagation();
                this._typed = e.key;
                cells[0].edit(true);
            }
        }

        _editor(num) {
            return (cell, onRendered, success, cancel) => {
                const input = document.createElement("input");
                input.type = "text";
                input.className = num ? "ced" : "ced txt";
                const v = cell.getValue();
                const typed = this._typed;
                this._typed = null;
                input.value = typed ? typed : v === null || v === undefined ? "" : num ? nfCopy.format(v) : v;
                onRendered(() => { input.focus(); if (!typed) input.select(); });
                let done = false;
                const finish = (commit) => {
                    if (done) return;
                    done = true;
                    const text = input.value;
                    cancel();
                    if (commit) this._commit(cell, text, num);
                };
                input.addEventListener("blur", () => finish(true));
                input.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); finish(true); }
                    else if (e.key === "Escape") finish(false);
                });
                return input;
            };
        }

        _commit(cell, text, num) {
            const row = this._rowOf(cell.getData().key);
            const field = cell.getField();
            if (!row) return;
            if (num) {
                const v = parseNum(text);
                if (v !== v) { this._setStatus(`Sayı değil: ${text}`, true); return; }
                if (this._setCell(row, field, v)) this._flush(new Set([row]));
                return;
            }
            const vals = this._rowDims.map((d, i) => d.attr ? null : "r" + i === field ? text.trim() : row["r" + i]).filter(v => v !== null);
            this._fillRow(row, vals);
            const u = { key: row.key };
            this._rowDims.forEach((d, i) => {
                u["r" + i] = row["r" + i];
                if (this._twoCols(d.id)) u[`r${i}d`] = row[`r${i}d`];
            });
            this._table.updateData([u]);
        }

        // boş bırakılan dolu hücre = 0 yazılır
        _setCell(row, field, val) {
            const k = row.key + SEP + field;
            const d = this._dirty.get(k);
            const cur = row[field] === undefined ? null : row[field];
            const orig = d ? d.orig : cur;
            if (val === null && orig !== null) val = 0;
            if (val === cur) return false;
            row[field] = val;
            if (val === orig || (val !== null && orig !== null && Math.abs(val - orig) < 1e-9)) this._dirty.delete(k);
            else this._dirty.set(k, { row, field, orig });
            return true;
        }

        _flush(rows) {
            if (!rows.size) return;
            const fields = this._leaves.map(c => c.field);
            const upd = [];
            rows.forEach(row => {
                this._rowTotals(row);
                if (!this._table.getRow(row.key)) return;
                const u = { key: row.key };
                fields.forEach(f => { u[f] = row[f] === undefined ? null : row[f]; });
                upd.push(u);
            });
            upd.push(this._totalRow());
            this._table.updateData(upd);
            this._updateStatus();
        }

        _paste(text) {
            const cells = this._rangeCells();
            if (!cells.length || !this._canWrite || this._saving) return;
            const r0 = this._shown.findIndex(r => r.key === cells[0].getData().key);
            const c0 = this._vFields.indexOf(cells[0].getField());
            if (r0 < 0 || c0 < 0) return;
            const lines = text.replace(/\r/g, "").split("\n");
            if (lines[lines.length - 1] === "") lines.pop();
            const rows = new Set();
            let bad = 0;
            lines.forEach((line, i) => {
                const row = this._shown[r0 + i];
                if (!row) return;
                line.split("\t").forEach((t, j) => {
                    const f = this._vFields[c0 + j];
                    if (!f) return;
                    const v = parseNum(t);
                    if (v !== v) { bad++; return; }
                    if (v !== null && this._setCell(row, f, v)) rows.add(row);
                });
            });
            this._flush(rows);
            if (bad) this._setStatus(`${bad} hücre sayı değil, atlandı.`, true);
        }

        _addRow() {
            if (!this._table || !this._canWrite || this._saving) return;
            const row = { key: "\u0002" + (++this._newSeq), _new: true };
            this._fillRow(row, this._plainRows.map(() => ""));
            this._newRows.unshift(row);
            this._applyFilter();
        }

        _syncSave() {
            const n = this._dirty.size;
            this._saveBtn.disabled = !n || !!this._saving;
            this._saveBtn.classList.toggle("on", n > 0 && !this._saving);
            this._saveBtn.textContent = this._saving ? "Kaydediliyor…" : n ? `Kaydet (${n})` : "Kaydet";
        }

        async _post(path, body, csrf) {
            const resp = await fetch(`${window.location.origin}/api/v1/dataimport/${path}`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", Accept: "application/json", "x-csrf-token": csrf },
                body: JSON.stringify(body)
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 300)}`);
            try { return JSON.parse(text); } catch (e) { return {}; }
        }

        async _job(path) {
            const resp = await fetch(`${window.location.origin}/api/v1/dataimport/${path}`, { credentials: "include", headers: { Accept: "application/json" } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
            return resp.json();
        }

        // değişen hücreleri tam anahtarlı kayıtlara çevirir
        async _records() {
            const recs = new Map();
            const seen = new Map();
            this._dirty.forEach(({ row, field }) => {
                const ci = Number(field.match(/^v(\d+)_/)[1]);
                let vals = seen.get(row);
                if (!vals) {
                    vals = this._plainRows.map((d, j) => String(row["r" + this._rowDims.indexOf(d)] || "").trim() || hashOf(d.id));
                    if (row._new) {
                        this._plainRows.forEach((d, j) => {
                            const ids = this._ids.get(d.id);
                            if (ids && vals[j] !== hashOf(d.id) && ids.indexOf(vals[j]) < 0) throw new Error(`${d.label} anaveride yok: ${vals[j]}`);
                        });
                        if (this._byKey.has(vals.join(SEP))) throw new Error(`Bu satır zaten var: ${vals.join(" / ")}`);
                    }
                    seen.set(row, vals);
                }
                const k = vals.join(SEP) + SEP + ci;
                if (recs.has(k)) return;
                const rec = {};
                this._fixed.forEach((v, d) => { rec[d] = v; });
                this._plainRows.forEach((d, j) => { rec[d.id] = vals[j]; });
                this._p.cols.forEach((d, j) => { rec[d.id] = this._cols[ci].vals[j]; });
                this._mIds.forEach((m, mi) => {
                    const v = row[`v${ci}_${mi}`];
                    if (v !== undefined && v !== null) rec[m] = Math.round(v * 1e7) / 1e7;
                });
                recs.set(k, rec);
            });
            // ekranda olmayan measure'lar mevcut değeriyle gider
            const other = this._allM.filter(m => this._mIds.indexOf(m) < 0);
            if (other.length) {
                const d0 = this._plainRows[0].id;
                const dims = this._plainRows.map(d => d.id).concat(this._p.cols.map(d => d.id));
                const v0 = Array.from(new Set(Array.from(recs.values()).map(r => r[d0])));
                const sets = await Promise.all(chunks(v0, 40).map(c => this._get("FactDataAggregation", { $select: dims.concat(other).join(","), $filter: and(this._filter, orEq(d0, c)) })));
                const colIndex = new Map(this._cols.map(c => [c.vals.join(SEP), c.ci]));
                [].concat(...sets).forEach(r => {
                    const ci = colIndex.get(this._p.cols.map(d => r[d.id]).join(SEP));
                    const rec = recs.get(this._plainRows.map(d => r[d.id]).join(SEP) + SEP + ci);
                    if (rec) other.forEach(m => { if (r[m] !== null && r[m] !== undefined && r[m] !== "") rec[m] = Number(r[m]); });
                });
            }
            return Array.from(recs.values());
        }

        async save() {
            if (this._saving || !this._dirty.size) return;
            if (!this._canWrite) { this._setStatus(this._roWhy, true); return; }
            this._saving = true;
            this._syncSave();
            let step = "kayıtlar hazırlanıyor";
            try {
                const data = await this._records();
                this._setStatus(`Kaydediliyor: ${nf.format(data.length)} kayıt…`);
                step = "CSRF";
                const cr = await fetch(`${window.location.origin}/api/v1/csrf`, { credentials: "include", headers: { "x-csrf-token": "Fetch" } });
                const csrf = cr.headers.get("x-csrf-token") || "";
                step = "job";
                const job = await this._post(`models/${encodeURIComponent(this._pid)}/factData`, { JobSettings: { importMethod: "Update", executeWithFailedRows: false, ignoreAdditionalColumns: true } }, csrf);
                if (!job.jobID) throw new Error("jobID dönmedi");
                step = "veri";
                for (const part of chunks(data, 1000)) {
                    const r = await this._post(`jobs/${job.jobID}`, { Data: part }, csrf);
                    if (r.failedNumberRows > 0) throw new Error(`${r.failedNumberRows} satır reddedildi: ${JSON.stringify((r.failedRows || [])[0] || "").slice(0, 300)}`);
                }
                step = "doğrulama";
                const val = await this._post(`jobs/${job.jobID}/validate`, {}, csrf);
                if (val.failedNumberRows > 0) {
                    const inv = await this._job(`jobs/${job.jobID}/invalidRows`).catch(() => ({}));
                    throw new Error(`${val.failedNumberRows} satır geçersiz: ${JSON.stringify((inv.failedRows || inv.value || [inv])[0] || "").slice(0, 300)}`);
                }
                step = "yazma";
                await this._post(`jobs/${job.jobID}/run`, {}, csrf);
                let status = "PROCESSING";
                for (let i = 0; i < 300 && status !== "COMPLETED"; i++) {
                    await sleep(1000);
                    status = (await this._job(`jobs/${job.jobID}/status`)).jobStatus || "";
                    if (/FAIL|ERROR|CANCEL/i.test(status)) throw new Error(`job ${status}`);
                }
                if (status !== "COMPLETED") throw new Error(`job bitmedi (${status})`);
                this._saving = false;
                this._flash = `Kaydedildi: ${nf.format(data.length)} kayıt`;
                this.dispatchEvent(new CustomEvent("onSaved"));
                this._reload(true);
            } catch (e) {
                this._saving = false;
                this._syncSave();
                this._setStatus(`Kaydedilemedi (${step}): ${errText(e)}`, true);
            }
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
            this._syncSave();
            const n = this._shown.length;
            const all = this._rows.length + this._newRows.length;
            const flash = this._flash ? this._flash + " · " : "";
            this._flash = "";
            if (!this._canWrite && this._roWhy) { this._setStatus(this._roWhy, true); return; }
            const secs = this._loadMs ? ` · ${(this._loadMs / 1000).toFixed(1)} sn` : "";
            const ch = this._dirty.size ? ` · ${this._dirty.size} değişiklik kaydedilmedi` : "";
            this._setStatus(`${flash}${n === all ? nf.format(all) : `${nf.format(n)} / ${nf.format(all)}`} satır${secs}${ch}`);
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
            $("popClear").addEventListener("click", () => { this._selEdit = [{ low: "", high: "" }]; this._rowsChanged(true); });
            $("popOk").addEventListener("click", () => {
                if (this._genTokens && !this._checked.size) {
                    this._hitInfoEl.textContent = "En az bir değer seçin.";
                    return;
                }
                if (!this._genTokens) this._readSelRows();
                const text = this._genTokens ? this._genTokens.join("; ") : this._selEdit.filter(s => s.low).map(tokenText).join("; ");
                this._closePopup();
                this._popCtx.apply(text);
            });
            $("hitAll").addEventListener("click", () => this._checkMatches(true));
            $("hitNone").addEventListener("click", () => this._checkMatches(false));
            this._selRowsEl.addEventListener("input", () => {
                clearTimeout(this._rowsTimer);
                this._rowsTimer = setTimeout(() => this._rowsChanged(false), 200);
            });
            $("addRow").addEventListener("click", () => {
                this._readSelRows();
                this._genTokens = null;
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
                if (e.target.checked) this._checked.add(e.target.value);
                else this._checked.delete(e.target.value);
                this._checksChanged();
            });
            this._pop.addEventListener("keydown", (e) => { if (e.key === "Escape") this._closePopup(); });
        }

        _openPopup(i, btn) {
            const d = this._rowDims[i];
            if (!this._dimIds.has(i)) this._dimIds.set(i, Array.from(new Set(this._rows.map(r => r["r" + i]))).sort(cmpCode));
            const input = this._inputs.get(d.id);
            if (input) input.value = this._sel.get(d.id) || "";
            this._showPopup({ label: d.label, ids: this._dimIds.get(i), text: this._sel.get(d.id) || "", desc: this._desc.get(d.id), apply: (text) => this._setSel(d.id, text) }, btn);
        }

        _showPopup(ctx, btn) {
            this._popCtx = ctx;
            this._root.getElementById("popTitle").textContent = `${ctx.label} seçimi`;
            this._root.getElementById("popSearchLbl").textContent = `${ctx.label} ara`;
            const wrap = this._root.querySelector(".wrap").getBoundingClientRect();
            this._pop.style.left = Math.max(8, Math.min(btn.getBoundingClientRect().left - wrap.left - 200, wrap.width - 468)) + "px";
            this._selEdit = splitList(ctx.text).map(parseToken);
            if (!this._selEdit.length) this._selEdit.push({ low: "", high: "" });
            this._genTokens = null;
            const m = matcher(ctx.text);
            this._checked = new Set(ctx.ids.filter(id => !m || m(id)));
            this._renderSelRows();
            this._searchEl.value = "";
            this._pop.hidden = false;
            this._search();
            this._searchEl.focus();
        }

        _closePopup() {
            this._pop.hidden = true;
        }

        _rowsChanged(render) {
            if (!render) this._readSelRows();
            this._genTokens = null;
            const m = matcher(this._selEdit.filter(s => s.low).map(tokenText).join("; "));
            this._checked = new Set(this._popCtx.ids.filter(id => !m || m(id)));
            if (render) this._renderSelRows();
            this._renderHits();
        }

        _checksChanged() {
            const all = this._popCtx.ids;
            const on = this._checked;
            const pick = on.size <= all.length - on.size;
            this._genTokens = on.size === all.length ? [] : all.filter(id => on.has(id) === pick).map(id => (pick ? "" : "!") + quoteId(id));
            this._selEdit = this._genTokens.length ? this._genTokens.map(t => ({ low: t, high: "" })) : [{ low: "", high: "" }];
            this._renderSelRows();
            this._renderHits();
        }

        _checkMatches(on) {
            (this._matches || []).forEach(id => { if (on) this._checked.add(id); else this._checked.delete(id); });
            this._checksChanged();
        }

        _readSelRows() {
            if (this._genTokens && this._genTokens.length > SEL_ROWS_MAX) {
                this._selEdit = this._genTokens.map(t => ({ low: t, high: "" }));
                return;
            }
            this._selEdit = Array.from(this._selRowsEl.querySelectorAll(".sel-row")).map(r => {
                const [lo, hi] = r.querySelectorAll("input");
                return { low: lo.value.trim(), high: hi.value.trim() };
            });
        }

        _renderSelRows() {
            this._selRowsEl.innerHTML = "";
            if (this._genTokens && this._genTokens.length > SEL_ROWS_MAX) {
                const all = this._popCtx.ids.length;
                const info = document.createElement("div");
                info.className = "sel-more";
                info.textContent = `Listeden ${nf.format(this._checked.size)} / ${nf.format(all)} değer seçili`;
                this._selRowsEl.appendChild(info);
                return;
            }
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
                    if (!this._selEdit.length) this._selEdit.push({ low: "", high: "" });
                    this._rowsChanged(true);
                });
                this._selRowsEl.appendChild(row);
            });
        }

        _popLabel(id) {
            const desc = this._popCtx.desc;
            return desc ? desc.get(id) || "" : "";
        }

        _search() {
            const term = this._searchEl.value.trim();
            const all = this._popCtx.ids;
            let hits;
            if (!term) {
                hits = all;
            } else {
                const lower = term.toLocaleLowerCase("tr-TR");
                const m = /[*?]/.test(term) ? matcher(term) : null;
                hits = all.filter(id => m ? m(id) : id.indexOf(term) >= 0 || (id === "" ? BLANK : this._popLabel(id)).toLocaleLowerCase("tr-TR").indexOf(lower) >= 0);
            }
            const more = hits.length > MAX_HITS;
            this._matches = hits;
            this._hits = hits.slice(0, MAX_HITS);
            this._renderHits();
            this._hitInfoEl.textContent = hits.length
                ? `${nf.format(hits.length)} değer${term ? ` / ${nf.format(all.length)}` : ""}${more ? ` (ilk ${MAX_HITS} gösteriliyor; Tümünü seç/kaldır hepsine uygulanır)` : ""}`
                : "Eşleşen değer yok.";
        }

        _renderHits() {
            if (!this._hits) return;
            this._hitsEl.innerHTML = "";
            const frag = document.createDocumentFragment();
            this._hits.forEach(id => {
                const label = document.createElement("label");
                label.innerHTML = `<input type="checkbox"><b></b><span></span>`;
                const cb = label.querySelector("input");
                cb.value = id;
                cb.checked = this._checked.has(id);
                label.querySelector("b").textContent = id === "" ? BLANK : id;
                label.querySelector("span").textContent = this._popLabel(id);
                frag.appendChild(label);
            });
            this._hitsEl.appendChild(frag);
        }
    }

    customElements.define("custom-sac-giris", SacGiris);
})();
