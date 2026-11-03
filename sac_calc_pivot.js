(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js";
    const FFLATE_JS = "https://unpkg.com/fflate@0.8.2/esm/browser.js";
    const MAX_HITS = 200;
    const NO_MASTER = new Set(["Date", "Version", "ZCURRENCY"]);
    const DIM_LABEL = { Date: "Dönem", Version: "Versiyon" };
    const DESC_ONLY = new Set(["ZPARAMETRE"]);
    const SCRIPT_ONLY = [["Version", "setVersion"], ["ZSIRKET_KODU", "setCompanyCode"]];
    const CUR_FREE = new Set(["ZORAN", "ZMIKTAR"]);
    const SUP_PARAMS = new Set(["USM0008"]);
    const TUTAR_MEASURES = ["ZTUTAR_EUR", "ZTUTAR_TRY", "ZTUTAR_USD"];
    const SEP = "\u0001";
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
    const nfPct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 2 });
    const valFormatter = (fmt) => (cell) => {
        const v = cell.getValue();
        const empty = v === undefined || v === null;
        const el = cell.getElement();
        if (el.classList.contains("dash") !== empty) el.classList.toggle("dash", empty);
        if (!empty) return fmt.format(v);
        const d = cell.getData();
        return d._total || d._wait ? "" : "–";
    };
    const numFormatter = valFormatter(nf);
    const pctFormatter = valFormatter(nfPct);
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

    // SAC Karlılık Modeli > Calculations birebir (Name, Description, Formula)
    const FORMULAS = `
R_CIRO	Ciro	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0001")
R_ADET	Satış Adedi	RESTRICT([ZMIKTAR], [d/ZPARAMETRE] = "KAR0002")
R_DIR_ISCILIK	Direkt İşçilik (720)	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0007")
R_ENDIR_ISCILIK	Endirekt İşçilik	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0010")
R_MALZ_MALIYET	Malzeme Maliyeti	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0003")
R_TOPLAM_SURE	Toplam İşçilik Süresi (Saat)	RESTRICT([ZMIKTAR], [d/ZPARAMETRE] = "KAR0005")
R_AMORTISMAN_730	Amortisman (730)	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0012")
R_ENERJI	Enerji	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0014")
R_GUG	GÜG	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0016")
R_DIGER_GIDER	Diğer Gider	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0018")
R_740	740	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0026")
R_750	750	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0029")
R_760	760	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0032")
R_770	770	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0035")
R_TOP_AMORTISMAN	Toplam Amortisman	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0043")
R_FINANSMAN_GID	Finansman Gideri	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "KAR0047")
C_BIRIM_ISCILIK	Birim İşçilik Maliyeti	IF([R_ADET] = 0, 0, ([R_DIR_ISCILIK] + [R_ENDIR_ISCILIK]) / [R_ADET])
C_730	730	[R_ENDIR_ISCILIK] + [R_AMORTISMAN_730] + [R_ENERJI] + [R_GUG] + [R_DIGER_GIDER]
C_TOPLAM_ISCILIK	Toplam İşçilik Maliyeti	[R_DIR_ISCILIK] + [C_730]
C_SMM	SMM	[R_MALZ_MALIYET] + [C_TOPLAM_ISCILIK]
C_BRUT_KAR	Brüt Kar	[R_CIRO] - [C_SMM]
C_FAALIYET_GID	Faaliyet Giderleri	[R_740] + [R_750] + [R_760] + [R_770]
C_FAALIYET_KARI	Faaliyet Karı	[C_BRUT_KAR] - [C_FAALIYET_GID]
C_EBITDA	EBITDA	[C_FAALIYET_KARI] + [R_TOP_AMORTISMAN]
C_NET_KAR	KAR	[C_FAALIYET_KARI] - [R_FINANSMAN_GID]
C_MALZ_CIRO_PCT	Malzeme Maliyeti / Ciro (%)	IF([R_CIRO] = 0, 0, [R_MALZ_MALIYET] / [R_CIRO])
C_DIR_ISC_CIRO_PCT	Direkt İşçilik / Ciro (%)	IF([R_CIRO] = 0, 0, [R_DIR_ISCILIK] / [R_CIRO])
C_ENDIR_ISC_CIRO_PCT	Endirekt İşçilik / Ciro (%)	IF([R_CIRO] = 0, 0, [R_ENDIR_ISCILIK] / [R_CIRO])
C_AMORT_CIRO_PCT	Amortisman / Ciro (%)	IF([R_CIRO] = 0, 0, [R_AMORTISMAN_730] / [R_CIRO])
C_ENERJI_CIRO_PCT	Enerji / Ciro (%)	IF([R_CIRO] = 0, 0, [R_ENERJI] / [R_CIRO])
C_GUG_CIRO_PCT	GÜG / Ciro (%)	IF([R_CIRO] = 0, 0, [R_GUG] / [R_CIRO])
C_DIGER_CIRO_PCT	Diğer Gider / Ciro (%)	IF([R_CIRO] = 0, 0, [R_DIGER_GIDER] / [R_CIRO])
C_TOP_ISC_CIRO_PCT	Toplam İşçilik / Ciro (%)	IF([R_CIRO] = 0, 0, [C_TOPLAM_ISCILIK] / [R_CIRO])
C_SMM_CIRO_PCT	SMM / Ciro (%)	IF([R_CIRO] = 0, 0, [C_SMM] / [R_CIRO])
C_BRUT_KAR_CIRO_PCT	Brüt Kar / Ciro (%)	IF([R_CIRO] = 0, 0, [C_BRUT_KAR] / [R_CIRO])
C_740_CIRO_PCT	740 / Ciro (%)	IF([R_CIRO] = 0, 0, [R_740] / [R_CIRO])
C_740_SMM_PCT	740 / SMM (%)	IF([C_SMM] = 0, 0, [R_740] / [C_SMM])
C_750_CIRO_PCT	750 / Ciro (%)	IF([R_CIRO] = 0, 0, [R_750] / [R_CIRO])
C_750_SMM_PCT	750 / SMM (%)	IF([C_SMM] = 0, 0, [R_750] / [C_SMM])
C_760_CIRO_PCT	760 / Ciro (%)	IF([R_CIRO] = 0, 0, [R_760] / [R_CIRO])
C_760_SMM_PCT	760 / SMM (%)	IF([C_SMM] = 0, 0, [R_760] / [C_SMM])
C_770_CIRO_PCT	770 / Ciro (%)	IF([R_CIRO] = 0, 0, [R_770] / [R_CIRO])
C_770_SMM_PCT	770 / SMM (%)	IF([C_SMM] = 0, 0, [R_770] / [C_SMM])
C_FAAL_GID_CIRO_PCT	Faaliyet Gideri / Ciro (%)	IF([R_CIRO] = 0, 0, [C_FAALIYET_GID] / [R_CIRO])
C_FAAL_GID_SMM_PCT	Faaliyet Gideri / SMM (%)	IF([C_SMM] = 0, 0, [C_FAALIYET_GID] / [C_SMM])
C_FAAL_KAR_CIRO_PCT	Faaliyet Karı / Ciro (%)	IF([R_CIRO] = 0, 0, [C_FAALIYET_KARI] / [R_CIRO])
C_TOP_AMORT_CIRO_PCT	Toplam Amortisman / Ciro (%)	IF([R_CIRO] = 0, 0, [R_TOP_AMORTISMAN] / [R_CIRO])
C_EBITDA_CIRO_PCT	EBITDA / Ciro (%)	IF([R_CIRO] = 0, 0, [C_EBITDA] / [R_CIRO])
C_FIN_GID_CIRO_PCT	Finansman Giderleri / Ciro (%)	IF([R_CIRO] = 0, 0, [R_FINANSMAN_GID] / [R_CIRO])
C_NET_KAR_CIRO_PCT	Kar / Ciro (%)	IF([R_CIRO] = 0, 0, [C_NET_KAR] / [R_CIRO])
R_USM_SMM	Toplam SMM	RESTRICT([ZTUTAR_EUR], [d/ZPARAMETRE] = "USM0028")
`;
    const CMP = {
        "=": (a, b) => a === b, "<>": (a, b) => a !== b, "!=": (a, b) => a !== b,
        "<": (a, b) => a < b, ">": (a, b) => a > b, "<=": (a, b) => a <= b, ">=": (a, b) => a >= b
    };
    const compileExpr = (src) => {
        const toks = src.match(/\[[^\]]+\]|\d+(?:\.\d+)?|<>|<=|>=|!=|[A-Za-z_]\w*|[-+*/(),=<>]/g) || [];
        const refs = new Set();
        let i = 0;
        const fail = () => { throw new Error(`Formül okunamadı: ${src}`); };
        const take = (t) => { if (toks[i] !== t) fail(); i++; };
        const expr = () => {
            const a = sum();
            const f = CMP[toks[i]];
            if (!f) return a;
            i++;
            const b = sum();
            return (v) => f(a(v), b(v)) ? 1 : 0;
        };
        const sum = () => {
            let a = prod();
            while (toks[i] === "+" || toks[i] === "-") {
                const op = toks[i++], l = a, r = prod();
                a = op === "+" ? (v) => l(v) + r(v) : (v) => l(v) - r(v);
            }
            return a;
        };
        const prod = () => {
            let a = unary();
            while (toks[i] === "*" || toks[i] === "/") {
                const op = toks[i++], l = a, r = unary();
                a = op === "*" ? (v) => l(v) * r(v) : (v) => { const d = r(v); return d ? l(v) / d : NaN; };
            }
            return a;
        };
        const unary = () => {
            if (toks[i] !== "-") return atom();
            i++;
            const a = unary();
            return (v) => -a(v);
        };
        const atom = () => {
            const t = toks[i++];
            if (t === undefined) fail();
            if (t[0] === "[") {
                const name = t.slice(1, -1).trim();
                refs.add(name);
                return (v) => v(name);
            }
            if (/^\d/.test(t)) { const n = Number(t); return () => n; }
            if (t === "(") { const a = expr(); take(")"); return a; }
            if (t.toUpperCase() === "IF") {
                take("(");
                const c = expr(); take(",");
                const a = expr(); take(",");
                const b = expr(); take(")");
                return (v) => c(v) ? a(v) : b(v);
            }
            return fail();
        };
        const fn = expr();
        if (i < toks.length) fail();
        return { fn, refs };
    };
    const parseFormulas = (text) => {
        const out = new Map();
        text.split("\n").forEach(line => {
            const [id, desc, src] = line.split("\t").map(s => (s || "").trim());
            if (!id || !src) return;
            const r = src.match(/^RESTRICT\(\s*\[([^\]]+)\]\s*,\s*\[d\/([^\]]+)\]\s*=\s*"([^"]*)"\s*\)$/i);
            out.set(id, r ? { id, desc, base: r[1].trim(), dim: r[2].trim(), val: r[3] } : Object.assign({ id, desc }, compileExpr(src)));
        });
        return out;
    };
    const CALC = parseFormulas(FORMULAS);
    const ATOM_KEY = /^([au]\d*)_\d+$/;
    const VAL_KEY = /^[auvt]\d*_\d+$/;
    const isPct = (id) => {
        const c = CALC.get(id);
        return !!c && (/_PCT$/.test(id) || /\(%\)/.test(c.desc));
    };
    const planMeasures = (measures, tutar) => {
        const atoms = [];
        const idx = new Map();
        const atomOf = (name) => {
            if (!idx.has(name)) {
                const c = CALC.get(name);
                idx.set(name, atoms.length);
                const base = c && c.base && tutar && TUTAR_MEASURES.indexOf(c.base) >= 0 ? tutar : c && c.base;
                atoms.push(base ? { id: name, base, dim: c.dim, val: c.val } : { id: name, base: name });
            }
            return idx.get(name);
        };
        const evalOf = (name) => {
            const c = CALC.get(name);
            if (!c || !c.fn) {
                const ai = atomOf(name);
                return (get) => { const x = get(ai); return x === undefined ? null : x; };
            }
            const leafs = new Map();
            const walk = (n, path) => {
                const k = CALC.get(n);
                if (!k || !k.fn) { leafs.set(n, atomOf(n)); return; }
                if (path.has(n)) throw new Error(`Döngülü formül: ${n}`);
                path.add(n);
                k.refs.forEach(r => walk(r, path));
                path.delete(n);
            };
            walk(name, new Set());
            const leafIdx = Array.from(leafs.values());
            return (get) => {
                if (!leafIdx.some(ai => get(ai) !== undefined)) return null;
                const memo = new Map();
                const val = (n) => {
                    if (leafs.has(n)) return get(leafs.get(n)) || 0;
                    if (!memo.has(n)) memo.set(n, CALC.get(n).fn(val));
                    return memo.get(n);
                };
                const x = c.fn(val);
                return isFinite(x) ? x : null;
            };
        };
        const evals = measures.map(m => evalOf(m.id));
        return { atoms, evals, pct: measures.map(m => isPct(m.id)) };
    };

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
            <div class="bar"><label id="mSelWrap" hidden><select id="mSel" title="Measure"></select></label><button id="xls">Excel'e aktar</button><div id="status">Yükleniyor…</div></div>
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

    class SacCalcPivot extends HTMLElement {
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
            measures.forEach(m => { if (m.label === m.id && CALC.has(m.id)) m.label = CALC.get(m.id).desc || m.id; });
            const filters = parseFilters(this.filters);
            SCRIPT_ONLY.forEach(([d]) => filters.delete(d));
            this._override.forEach((vals, dim) => { if (vals.length) filters.set(dim, vals); else filters.delete(dim); });
            const fl = Array.from(filters.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
            const tutar = tutarOn ? this._tutar : null;
            const sig = JSON.stringify([pid, rows, cols, measures, fl, tutar]);
            return { pid, rows, cols, measures, filters, tutar, sig };
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
            this._full = false;
            this._bulkPromise = null;
            this._blocks = new Map();
            this._r0State = new Map();
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
            let plan;
            try {
                plan = planMeasures(p.measures, p.tutar);
            } catch (e) {
                this._destroyTable();
                this._setStatus(errText(e), true);
                return;
            }
            this._plan = plan;
            let filter = Array.from(p.filters.entries()).filter(([d]) => d.indexOf(".") < 0).map(([d, vals]) => orEq(d, vals)).join(" and ");
            const rDims = Array.from(new Set(plan.atoms.map(a => a.dim)));
            if (rDims.length === 1 && rDims[0] && !p.filters.has(rDims[0])) filter = and(filter, orEq(rDims[0], Array.from(new Set(plan.atoms.map(a => a.val)))));
            const qDims = rDims.filter(Boolean);
            const attrFilters = parseItems(Array.from(p.filters.keys()).filter(d => d.indexOf(".") > 0).join(","));
            const items = p.rows.concat(p.cols, attrFilters);
            const dims = Array.from(new Set(items.map(d => d.base)));
            const attrs = new Map();
            items.forEach(d => {
                if (!d.attr) return;
                if (!attrs.has(d.base)) attrs.set(d.base, new Set());
                attrs.get(d.base).add(d.attr);
            });
            const mIds = Array.from(new Set(plan.atoms.map(a => a.base)));
            const afBases = attrFilters.map(d => d.base);
            const rowSel = Array.from(new Set(p.rows.map(d => d.base).concat(afBases, qDims, p.rows.some(d => d.id === "ZTEDARIKCI") ? ["ZPARAMETRE"] : []))).concat(mIds).join(",");
            const colSel = Array.from(new Set(p.cols.map(d => d.base).concat(afBases, qDims))).concat(mIds).join(",");
            const sel = Array.from(new Set(dims.concat(qDims))).concat(mIds).join(",");
            const d0 = p.rows[0];
            this._p = p;
            this._af = attrFilters;
            this._filter = filter;
            this._qSel = sel;
            const t0 = Date.now();
            this._setStatus("Satırlar yükleniyor…");

            try {
                const hasDate = dims.indexOf("Date") >= 0;
                const fixedDates = hasDate && p.filters.has("Date") ? p.filters.get("Date") : null;
                const masterDims = dims.filter(d => !NO_MASTER.has(d) || attrs.has(d));
                const [, masters, rowRecs, colRecs, freshDates] = await Promise.all([
                    loadScript(TABULATOR_JS),
                    Promise.all(masterDims.map(d => this._get(`${d}Master`, { $select: ["ID", "Description"].concat(Array.from(attrs.get(d) || [])).join(",") })
                        .catch(e => { if (attrs.has(d)) throw new Error(`${d} özellikleri okunamadı (${Array.from(attrs.get(d)).join(", ")}): ${errText(e)}`); return []; }))),
                    this._get("FactDataAggregation", { $select: rowSel, $filter: filter }),
                    this._get("FactDataAggregation", { $select: colSel, $filter: filter }),
                    hasDate && !fixedDates ? this._get("FactDataAggregation", { $select: "Date," + mIds.join(","), $filter: filter })
                        .then(rows => Array.from(new Set(rows.map(r => r.Date).filter(Boolean))).sort()) : null
                ]);
                if (token !== this._token) return;
                this._desc = new Map();
                this._attrs = new Map();
                masterDims.forEach((d, i) => {
                    const m = new Map();
                    masters[i].forEach(r => { if (r.Description) m.set(r.ID, r.Description); });
                    if (m.size && !NO_MASTER.has(d)) this._desc.set(d, m);
                    if (attrs.has(d)) this._attrs.set(d, new Map(masters[i].map(r => [r.ID, r])));
                });
                this._buildData(Object.assign({}, p, { rows: [] }), [colRecs], attrFilters);
                const colState = { cols: this._cols, totCols: this._totCols, vUsed: this._vUsed };
                this._buildData(Object.assign({}, p, { cols: [] }), [rowRecs], attrFilters);
                Object.assign(this, { _cols: colState.cols, _totCols: colState.totCols, _vUsed: colState.vUsed });
                this._colIndex = new Map(this._cols.map(c => [c.vals.join(SEP), c.ci]));
                this._tParams = new Map();
                this._totCols.forEach(t => { if (t.param !== undefined) this._tParams.set(t.param, Number(t.field.slice(1, t.field.indexOf("_")))); });
                this._byRow = new Map();
                this._rows.forEach(row => {
                    for (const k in row) if (VAL_KEY.test(k)) delete row[k];
                    row._wait = true;
                    this._byRow.set(row.key, row);
                });
                if (!this._rows.length) {
                    this._destroyTable();
                    this._setStatus("Bu filtrelerle veri yok.");
                    return;
                }
                this._blockOn = !d0.attr && d0.id !== "ZCURRENCY" && this._rows.every(r => r.r0 !== "");
                this._preWild = this._blockOn ? this._get("FactDataAggregation", { $select: sel, $filter: and(filter, `${d0.id} eq '#'`) }) : null;
                if (this._preWild) this._preWild.catch(() => {});
                this._buildTable(p);
                this._loadMs = Date.now() - t0;
                this._updateStatus();
                this._bulkPromise = this._loadBulk(this._fetchBulk(!hasDate ? [null] : fixedDates || freshDates), token, t0);
                this._bulkPromise.catch(() => {});
            } catch (e) {
                if (token !== this._token || (e && e.name === "AbortError")) return;
                this._loadSig = null;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        _fetchBulk(dates) {
            return Promise.all(dates.map(d => this._get("FactDataAggregation", {
                $select: this._qSel,
                $filter: d === null ? this._filter : and(this._filter, `Date eq '${q(d)}'`)
            }))).then(sets => [].concat(...sets));
        }

        _fixed(only) {
            return { colIndex: this._colIndex, cols: this._cols, tParams: this._tParams, byRow: this._byRow, only };
        }

        _clearVals(rows) {
            const fields = this._leaves.map(c => c.field);
            rows.forEach(row => {
                for (const k in row) if (ATOM_KEY.test(k)) delete row[k];
                for (let i = 0; i < fields.length; i++) row[fields[i]] = null;
                row._wait = false;
            });
        }

        async _loadBulk(bulk, token, t0) {
            const recs = await bulk;
            if (token !== this._token) return;
            this._clearVals(this._rows);
            this._buildData(this._p, [recs], this._af, this._fixed(null));
            this._full = true;
            this._loadMs = Date.now() - t0;
            this._applyFilter();
        }

        _loadVisible() {
            if (!this._table || this._full || !this._blockOn) return;
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
            const vals = Array.from(new Set(shown.slice(start, start + BLOCK).map(r => r.r0))).filter(v => !this._r0State.has(v)).sort(cmpCode);
            if (!vals.length) return;
            vals.forEach(v => this._r0State.set(v, "busy"));
            const token = this._token;
            const d0 = this._p.rows[0].id;
            const real = vals.filter(v => v !== "#");
            const same = real.length && real.every(v => /^\d+$/.test(v) && v.length === real[0].length);
            try {
                const parts = !real.length ? [] : same ? [`${d0} ge '${q(real[0])}' and ${d0} le '${q(real[real.length - 1])}'`]
                    : chunks(real, 40).map(c => orEq(d0, c));
                const [pre, ...sets] = await Promise.all([this._preWild].concat(parts.map(f => this._get("FactDataAggregation", { $select: this._qSel, $filter: and(this._filter, f) }))));
                if (token !== this._token || this._full) return;
                const set = new Set(vals);
                const rows = this._rows.filter(r => set.has(r.r0));
                this._clearVals(rows);
                this._buildData(this._p, [[].concat(...sets).filter(r => r[d0] !== "#"), pre], this._af, this._fixed(new Set(rows.map(r => r.key))));
                vals.forEach(v => this._r0State.set(v, "done"));
                const fields = this._leaves.map(c => c.field);
                const upd = rows.filter(r => this._table.getRow(r.key)).map(r => {
                    const u = { key: r.key, _wait: false };
                    fields.forEach(f => { u[f] = r[f] === undefined ? null : r[f]; });
                    return u;
                });
                if (upd.length) await this._table.updateData(upd);
            } catch (e) {
                vals.forEach(v => { if (this._r0State.get(v) === "busy") this._r0State.delete(v); });
                this._blocks.delete(b);
                if (token === this._token && !(e && e.name === "AbortError")) this._setStatus("Değerler alınamadı: " + errText(e), true);
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

        _buildData(p, valueSets, attrFilters, fixed) {
            const rowIds = p.rows.map(d => d.id);
            const mIds = p.measures.map(m => m.id);
            const af = attrFilters.map(d => [d, new Set(p.filters.get(d.id))]);
            const withTotal = p.cols.length > 0;
            const pIdx = p.cols.length > 1 ? p.cols.findIndex(d => d.id === "ZPARAMETRE") : -1;
            const tParams = fixed ? fixed.tParams : new Map();
            const tUsed = new Set();
            const byRow = fixed ? fixed.byRow : new Map();
            const colIndex = fixed ? fixed.colIndex : new Map();
            const cols = fixed ? fixed.cols : [];
            const byCi = fixed ? new Map(cols.map(c => [c.ci, c])) : null;
            const only = fixed && fixed.only;
            const curIdx = p.rows.findIndex(d => d.id === "ZCURRENCY");
            const matIdx = p.rows.findIndex(d => d.id === "ZMALZEME");
            const supOn = p.rows.some(d => d.id === "ZTEDARIKCI");
            const atoms = this._plan.atoms;
            const free = atoms.map(a => CUR_FREE.has(a.base));
            const isNone = (v) => v === "#" || v === "";
            const freeVals = [];
            const vUsed = new Set();
            if (!fixed) this._vUsed = vUsed;
            const add = (row, ci, mi, x) => {
                if (!row || (only && !only.has(row.key))) return;
                const f = `a${ci}_${mi}`;
                row[f] = (row[f] || 0) + x;
                if (!withTotal) return;
                let tf = "u_" + mi;
                if (pIdx >= 0) {
                    const pv = (byCi ? byCi.get(ci) : cols[ci]).vals[pIdx];
                    let k = tParams.get(pv);
                    if (k === undefined) {
                        if (fixed) return;
                        tParams.set(pv, k = tParams.size);
                    }
                    tf = `u${k}_${mi}`;
                }
                row[tf] = (row[tf] || 0) + x;
            };
            const newRow = (rk, rvals) => {
                if (fixed) return null;
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
                const nums = atoms.map(a => {
                    if (a.dim && r[a.dim] !== a.val) return null;
                    const x = r[a.base];
                    return x === null || x === undefined || x === "" ? null : Number(x);
                });
                if (nums.every(x => x === null)) return;
                for (let k = 0; k < af.length; k++) if (!af[k][1].has(this._valueOf(af[k][0], r))) return;
                const cvals = p.cols.map(d => this._valueOf(d, r));
                const ck = cvals.join(SEP);
                let ci = colIndex.get(ck);
                if (ci === undefined) {
                    if (fixed) return;
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
            (only ? Array.from(only, k => byRow.get(k)).filter(Boolean) : Array.from(byRow.values())).forEach(row => this._calcRow(row, vUsed, tUsed));
            if (fixed) return;
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
            this._totCols = !withTotal ? [] : pIdx < 0 ? mIds.map((m, mi) => ({ field: "t_" + mi, mi })).filter(t => tUsed.has(t.field))
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

        _calcRow(row, vUsed, tUsed) {
            const groups = new Set();
            for (const k in row) {
                const m = ATOM_KEY.exec(k);
                if (m) groups.add(m[1]);
            }
            const evals = this._plan.evals;
            groups.forEach(g => {
                const cell = g[0] === "a";
                const out = (cell ? "v" : "t") + g.slice(1);
                const used = cell ? vUsed : tUsed;
                const get = (ai) => row[`${g}_${ai}`];
                for (let mi = 0; mi < evals.length; mi++) {
                    const x = evals[mi](get);
                    if (x === null) continue;
                    const f = `${out}_${mi}`;
                    row[f] = x;
                    if (used) used.add(f);
                }
            });
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
                    width: 105, hozAlign: "right", formatter: this._plan.pct[mi] ? pctFormatter : numFormatter, accessorClipboard: numCopy
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
                    return { title, field: t.field, headerTooltip: "Satır toplamı", headerWordWrap: true, width: 115, hozAlign: "right", formatter: this._plan.pct[t.mi] ? pctFormatter : numFormatter, accessorClipboard: numCopy, cssClass: "tot" };
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
            if (this._twoCols(this._rowDims[0].id)) row.r0d = this._full ? `${nf.format(shown.length)} satır` : "hesaplanıyor…";
            const fields = this._leaves.map(c => c.field);
            fields.forEach(f => { row[f] = null; });
            if (!this._full) return row;
            shown.forEach(r => {
                for (const k in r) if (ATOM_KEY.test(k)) row[k] = (row[k] || 0) + r[k];
            });
            this._calcRow(row);
            return row;
        }

        _applyFilter() {
            this._inputs.forEach((input, dim) => input.classList.toggle("on", this._sel.has(dim)));
            if (!this._table) return;
            this._shown = this._filtered();
            this._table.replaceData([this._totalRow()].concat(this._shown)).then(() => this._loadVisible());
            this._updateStatus();
        }

        _buildTable(p) {
            this._destroyTable();
            this._inputs = new Map();
            const columns = [];
            p.rows.forEach((d, i) => {
                const descOnly = DESC_ONLY.has(d.id) && this._desc.has(d.id);
                columns.push({
                    title: d.label, field: "r" + i, width: 150, titleFormatter: () => this._buildHeader(i, d),
                    formatter: descOnly ? (cell) => cell.getData()[`r${i}d`] || cell.getValue() : undefined,
                    accessorClipboard: descOnly ? (v, data) => data[`r${i}d`] || v : textCopy
                });
                if (this._twoCols(d.id)) columns.push({ title: d.label + " Tanımı", field: `r${i}d`, width: 230, cssClass: "soft" });
            });
            const fz = parseInt(this.freezeCols, 10);
            const first = this._twoCols(p.rows[0].id) ? 2 : 1;
            columns.forEach((c, k) => { c.frozen = k < (fz > 0 ? fz : first); });
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
            this._table.on("tableBuilt", () => this._loadVisible());
            this._table.on("scrollVertical", () => {
                if (this._scrollTimer) return;
                this._scrollTimer = setTimeout(() => { this._scrollTimer = null; this._loadVisible(); }, 100);
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

    customElements.define("custom-sac-calc-pivot", SacCalcPivot);
})();
