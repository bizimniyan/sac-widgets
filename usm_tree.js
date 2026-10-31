(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@5.5.0/dist/js/tabulator.min.js";
    const NONE = "#";
    const CHILD_FILTER = " and (ZBILESEN ne '#' or ZMASRAF_OGESI ne '#')";
    const CHUNK = 40;
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
    const fieldOf = (date, param) => `v${date}_${param}`;
    const fmtDate = (d) => /^\d{6}$/.test(d) ? `${d.slice(4)}.${d.slice(0, 4)}` : d;
    const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
    const numFormatter = (cell) => {
        const v = cell.getValue();
        return v === undefined || v === null ? "" : nf.format(v);
    };
    const addValue = (target, r) => {
        if (r.ZMIKTAR === null || r.ZMIKTAR === undefined) return;
        const f = fieldOf(r.Date, r.ZPARAMETRE);
        target[f] = (target[f] || 0) + r.ZMIKTAR;
    };

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@5.5.0/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { display: flex; flex-direction: column; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; }
            #status { flex: 0 0 auto; font-size: 12px; color: #666; padding: 4px 8px; }
            #status.error { color: #bb0000; white-space: pre-wrap; }
            #table { flex: 1 1 auto; min-height: 0; font-size: 13px; }
            .tabulator { border: 1px solid #e0e0e0 !important; background-color: #fff; }
            .tabulator-header { background-color: #f4f6f9 !important; color: #333; font-weight: 600; border-bottom: 2px solid #ddd !important; }
            .tabulator-row { border-bottom: 1px solid #eee; }
            .tabulator-row:hover { background-color: #f0f4f8 !important; }
            .tabulator-row.tabulator-tree-level-0 { font-weight: bold; }
            .tabulator-row.row-activity { color: #555; font-style: italic; }
            .tabulator-row.row-placeholder { color: #999; }
        </style>
        <div class="wrap">
            <div id="status">Yükleniyor…</div>
            <div id="table"></div>
        </div>
    `;

    class UsmTree extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._table = null;
            this._token = 0;
            this._desc = { ZMALZEME: new Map(), ZBILESEN: new Map(), ZMASRAF_OGESI: new Map() };
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if (["providerId", "version", "parameters", "pageSize"].some(k => k in changedProperties)) {
                this.refresh();
            }
        }

        onCustomWidgetResize() {
            if (this._table) this._table.redraw();
        }

        async refresh() {
            const token = ++this._token;
            this._skip = 0;
            this._count = 0;
            this._done = false;
            this._loading = false;
            this._failed = false;

            this._pid = (this.providerId || "").trim();
            let version = (this.version || "").trim();
            if (version && version.indexOf(".") < 0) version = "public." + version;
            this._params = (this.parameters || "").split(",").map(s => s.trim()).filter(Boolean);
            this._pageSize = this.pageSize > 0 ? this.pageSize : 100;

            if (!this._pid || !version || !this._params.length) {
                this._setStatus("Builder panelinden model, versiyon ve parametreleri girin.");
                return;
            }
            this._baseFilter = `Version eq '${q(version)}' and ${orEq("ZPARAMETRE", this._params)}`;
            this._setStatus("Yükleniyor…");

            try {
                await loadScript(TABULATOR_JS);
                const dates = (await this._get("FactDataAggregation", {
                    $select: "Date,ZMIKTAR",
                    $filter: this._baseFilter,
                    $orderby: "Date"
                })).map(r => r.Date).filter(d => d && d !== NONE);
                if (token !== this._token) return;
                if (!dates.length) {
                    this._destroyTable();
                    this._setStatus(`${version} versiyonunda bu parametrelerle veri yok.`);
                    return;
                }
                this._buildTable(dates);
            } catch (e) {
                this._setStatus("Yüklenemedi: " + (e && e.message ? e.message : e), true);
            }
        }

        _setStatus(text, isError) {
            this._statusEl.textContent = text;
            this._statusEl.className = isError ? "error" : "";
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
                const resp = await fetch(url, { method: "GET", credentials: "include", headers: { Accept: "application/json" } });
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
            await Promise.all(chunks(missing, CHUNK).map(async (part) => {
                const rows = await this._get(`${dim}Master`, { $select: "ID,Description", $filter: orEq("ID", part) });
                part.forEach(id => cache.set(id, ""));
                rows.forEach(r => cache.set(r.ID, r.Description || ""));
            }));
        }

        async _withChildren(ids) {
            const result = new Set();
            await Promise.all(chunks(ids, CHUNK).map(async (part) => {
                const rows = await this._get("FactDataAggregation", {
                    $select: "ZMALZEME,ZMIKTAR",
                    $filter: `${this._baseFilter} and ${orEq("ZMALZEME", part)}${CHILD_FILTER}`
                });
                rows.forEach(r => result.add(r.ZMALZEME));
            }));
            return result;
        }

        _row(key, type, id, dim, expandable) {
            const desc = this._desc[dim].get(id);
            const row = { key, type: TYPE_LABEL[type], name: desc ? `${id} - ${desc}` : id, _id: id, _kind: type };
            if (expandable) row._children = [{ key: key + "/…", name: "Yükleniyor…", _kind: "P" }];
            return row;
        }

        _buildTable(dates) {
            this._destroyTable();
            const columns = [
                { title: "Malzeme / Bileşen / Aktivite", field: "name", width: 360, frozen: true },
                { title: "Tür", field: "type", width: 80, frozen: true }
            ];
            dates.forEach(d => {
                columns.push({
                    title: fmtDate(d),
                    columns: this._params.map(p => ({
                        title: p, field: fieldOf(d, p), width: 95, hozAlign: "right", formatter: numFormatter
                    }))
                });
            });

            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: [],
                height: "100%",
                layout: "fitData",
                columns: columns,
                columnDefaults: { headerSort: false },
                dataTree: true,
                dataTreeStartExpanded: false,
                dataTreeChildIndent: 22,
                dataTreeElementColumn: "name",
                placeholder: "",
                rowFormatter: (row) => {
                    const k = row.getData()._kind;
                    if (k === "A") row.getElement().classList.add("row-activity");
                    if (k === "P") row.getElement().classList.add("row-placeholder");
                }
            });
            this._table.on("tableBuilt", () => this._loadPage());
            this._table.on("scrollVertical", () => this._maybeLoad());
            this._table.on("dataTreeRowExpanded", (row) => this._expand(row));
        }

        _maybeLoad() {
            if (this._loading || this._done || this._failed || !this._table) return;
            const holder = this._tableEl.querySelector(".tabulator-tableholder");
            if (!holder) return;
            if (holder.scrollTop + holder.clientHeight >= holder.scrollHeight - 400) this._loadPage();
        }

        async _loadPage() {
            if (this._loading || this._done || this._failed) return;
            this._loading = true;
            const token = this._token;
            try {
                const ids = (await this._get("FactDataAggregation", {
                    $select: "ZMALZEME,ZMIKTAR",
                    $filter: this._baseFilter,
                    $orderby: "ZMALZEME",
                    $skip: this._skip,
                    $top: this._pageSize
                })).map(r => r.ZMALZEME);
                if (token !== this._token) return;
                this._skip += ids.length;
                if (ids.length < this._pageSize) this._done = true;

                const shown = ids.filter(id => id && id !== NONE);
                if (shown.length) {
                    const range = ` and ZMALZEME ge '${q(shown[0])}' and ZMALZEME le '${q(shown[shown.length - 1])}'`;
                    const [vals, parents] = await Promise.all([
                        this._get("FactDataAggregation", { $select: "ZMALZEME,Date,ZPARAMETRE,ZMIKTAR", $filter: this._baseFilter + range }),
                        this._get("FactDataAggregation", { $select: "ZMALZEME,ZMIKTAR", $filter: this._baseFilter + range + CHILD_FILTER }),
                        this._loadDescriptions("ZMALZEME", shown)
                    ]);
                    if (token !== this._token) return;
                    const expandable = new Set(parents.map(r => r.ZMALZEME));
                    const rows = new Map(shown.map(id => [id, this._row(`M${id}`, "M", id, "ZMALZEME", expandable.has(id))]));
                    vals.forEach(r => { if (rows.has(r.ZMALZEME)) addValue(rows.get(r.ZMALZEME), r); });
                    await this._table.addData(Array.from(rows.values()));
                    this._count += shown.length;
                }
                this._setStatus(`${nf.format(this._count)} malzeme yüklendi${this._done ? " (tamamı)" : " — devamı kaydırdıkça gelir"}`);
            } catch (e) {
                this._failed = true;
                this._setStatus("Yüklenemedi: " + (e && e.message ? e.message : e), true);
            } finally {
                if (token === this._token) this._loading = false;
            }
            if (token === this._token) setTimeout(() => this._maybeLoad(), 0);
        }

        async _expand(row) {
            const d = row.getData();
            if (d._kind === "P" || d._loaded || d._busy) return;
            d._busy = true;
            const token = this._token;
            try {
                const recs = await this._get("FactDataAggregation", {
                    $select: "Date,ZPARAMETRE,ZBILESEN,ZMASRAF_OGESI,ZMIKTAR",
                    $filter: `${this._baseFilter} and ZMALZEME eq '${q(d._id)}'${CHILD_FILTER}`
                });
                const comps = new Map();
                const acts = new Map();
                recs.forEach(r => {
                    let map, id;
                    if (r.ZBILESEN && r.ZBILESEN !== NONE) { map = comps; id = r.ZBILESEN; }
                    else if (r.ZMASRAF_OGESI && r.ZMASRAF_OGESI !== NONE) { map = acts; id = r.ZMASRAF_OGESI; }
                    else return;
                    if (!map.has(id)) map.set(id, {});
                    addValue(map.get(id), r);
                });
                const compIds = Array.from(comps.keys()).sort();
                const actIds = Array.from(acts.keys()).sort();
                const [expandable] = await Promise.all([
                    this._withChildren(compIds),
                    this._loadDescriptions("ZBILESEN", compIds),
                    this._loadDescriptions("ZMASRAF_OGESI", actIds)
                ]);
                if (token !== this._token) return;
                const children = [];
                compIds.forEach(id => children.push(Object.assign(this._row(`${d.key}/B${id}`, "B", id, "ZBILESEN", expandable.has(id)), comps.get(id))));
                actIds.forEach(id => children.push(Object.assign(this._row(`${d.key}/A${id}`, "A", id, "ZMASRAF_OGESI", false), acts.get(id))));
                await row.update({ _children: children.length ? children : null, _loaded: true, _busy: false });
            } catch (e) {
                d._busy = false;
                if (token !== this._token) return;
                await row.update({ _children: [{ key: d.key + "/!", name: "Hata: " + (e && e.message ? e.message : e), _kind: "P" }] });
            }
        }
    }

    customElements.define("custom-usm-tree", UsmTree);
})();
